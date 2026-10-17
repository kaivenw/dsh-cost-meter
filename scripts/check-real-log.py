#!/usr/bin/env python3
"""账目核验的第二通道：用 Python 从零实现同一套规则，跟 check-real-log.mjs 对账。

为什么要两份：单通道观测不算证据。JS 那份走的是插件真正在跑的那套模块，
这份是照官方定价页与放假通知重写的一遍——两份算出来的纳元完全相等，
才说明「插件算的数 = 日志里的 token × 价目表 × 当时时段」没有被实现细节带偏。

规则（与官方页一致）：
  高峰 = 北京时间周一至周五（不含法定节假日）9:00-12:00、14:00-18:00
  空闲 = 其余全部时段，单价 = 高峰的一半
  计费 = 缓存命中/未命中/写入 token × 各自单价 + 输出 token × 输出单价
  替换语义：同 (turn, step) 后到的用量样本替换先到的；llm/retry-started 清掉替换槽

用法：
  python3 scripts/check-real-log.py <session.v4.jsonl[.zstd]> [--json]
"""

import datetime
import json
import subprocess
import sys

NANO = 1_000_000_000
BEIJING = datetime.timezone(datetime.timedelta(hours=8))

# 官方价目（元 / 百万 tokens）。波谷为波峰一半。
PRICES = {
    'deepseek-flash': {
        'peak': {'hit': 0.04, 'miss': 2.0, 'out': 8.0},
        'offPeak': {'hit': 0.02, 'miss': 1.0, 'out': 4.0},
    },
    'deepseek-v4-pro': {
        'peak': {'hit': 0.30, 'miss': 9.0, 'out': 27.0},
        'offPeak': {'hit': 0.15, 'miss': 4.5, 'out': 13.5},
    },
}
# 国办发明电〔2025〕7号：2026 年放假日期（只列放假，不列调休上班的周末）。
HOLIDAYS = {
    '2026-01-01', '2026-01-02', '2026-01-03',
    '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
    '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
    '2026-04-04', '2026-04-05', '2026-04-06',
    '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
    '2026-06-19', '2026-06-20', '2026-06-21',
    '2026-09-25', '2026-09-26', '2026-09-27',
    '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
    '2026-10-06', '2026-10-07',
}
WINDOWS = [(9 * 60, 12 * 60), (14 * 60, 18 * 60)]
BUCKETS = ('cacheHit', 'cacheMiss', 'cacheWrite', 'output')


def period_of(ms):
    moment = datetime.datetime.fromtimestamp(ms / 1000, tz=BEIJING)
    if moment.weekday() >= 5:
        return 'offPeak'
    if moment.strftime('%Y-%m-%d') in HOLIDAYS:
        return 'offPeak'
    minutes = moment.hour * 60 + moment.minute
    return 'peak' if any(start <= minutes < end for start, end in WINDOWS) else 'offPeak'


def buckets_of(usage):
    return {
        'cacheMiss': int(usage.get('inputTokens') or 0),
        'cacheHit': int(usage.get('cacheReadTokens') or 0),
        'cacheWrite': int(usage.get('cacheWriteTokens') or 0),
        'output': int(usage.get('outputTokens') or 0),
    }


def usage_of(event):
    data = event.get('data') or {}
    if event.get('type') == 'assistant/message' and data.get('usage') is not None:
        return data['usage']
    if event.get('type') not in ('assistant/message', 'assistant/attempt'):
        return None
    stream = data.get('stream') or []
    for record in reversed(stream):
        chunk = (record or {}).get('chunk') or {}
        if chunk.get('type') == 'usage' and chunk.get('usage') is not None:
            return chunk['usage']
    return None


def price_of(route, period, buckets):
    model = (route or {}).get('model')
    entry = PRICES.get(model)
    if entry is None:
        return None, 0, {key: 0 for key in BUCKETS}
    rates = entry[period]
    per_bucket = {
        'cacheHit': round(buckets['cacheHit'] * rates['hit'] * 1000),
        'cacheMiss': round(buckets['cacheMiss'] * rates['miss'] * 1000),
        'cacheWrite': round(buckets['cacheWrite'] * rates['miss'] * 1000),
        'output': round(buckets['output'] * rates['out'] * 1000),
    }
    return model, sum(per_bucket.values()), per_bucket


def new_totals():
    return {
        'nano': 0,
        'nanoByBucket': {key: 0 for key in BUCKETS},
        'buckets': {key: 0 for key in BUCKETS},
        'calls': 0,
        'unpricedCalls': 0,
        'unpricedTokens': 0,
    }


def apply_delta(totals, buckets, nano, nano_by_bucket, priced, sign):
    tokens = sum(buckets.values())
    totals['nano'] += sign * nano
    totals['calls'] += sign
    for key in BUCKETS:
        totals['buckets'][key] += sign * buckets[key]
        totals['nanoByBucket'][key] += sign * nano_by_bucket[key]
    if not priced:
        totals['unpricedCalls'] += sign
        totals['unpricedTokens'] += sign * tokens


def main():
    if len(sys.argv) < 2:
        print('用法：python3 scripts/check-real-log.py <session.v4.jsonl[.zstd]>', file=sys.stderr)
        return 2
    path = sys.argv[1]
    if path.endswith('.zstd'):
        text = subprocess.run(['zstd', '-dc', path], check=True, capture_output=True).stdout.decode('utf-8')
    else:
        with open(path, encoding='utf-8') as handle:
            text = handle.read()

    events = [json.loads(line) for line in text.splitlines() if line.strip()]

    route = None
    last = None
    totals = new_totals()
    periods = {'peak': new_totals(), 'offPeak': new_totals()}
    models = {}

    for event in events:
        kind = event.get('type')
        data = event.get('data') or {}
        if kind == 'request/context':
            route = {'provider': data.get('provider'), 'model': data.get('model')}
            continue
        if kind == 'llm/retry-started':
            if last is not None and last['turn'] == data.get('turn') and last['step'] == data.get('step'):
                last = None
            continue
        usage = usage_of(event)
        if usage is None:
            continue
        turn, step = data.get('turn'), data.get('step')
        if not isinstance(turn, int) or not isinstance(step, int):
            continue
        source = (data.get('message') or {}).get('source') or {}
        effective = {'provider': source.get('provider'), 'model': source.get('model')} \
            if source.get('provider') and source.get('model') else route
        period = period_of(event.get('time') or 0)
        buckets = buckets_of(usage)
        model, nano, nano_by_bucket = price_of(effective, period, buckets)
        priced = model is not None and sum(buckets.values()) > 0
        if not priced:
            nano, nano_by_bucket = 0, {key: 0 for key in BUCKETS}
        key = model or f"{(effective or {}).get('provider')}/{(effective or {}).get('model')}"

        if last is not None and last['turn'] == turn and last['step'] == step:
            apply_delta(totals, last['buckets'], last['nano'], last['nanoByBucket'], last['priced'], -1)
            apply_delta(periods[last['period']], last['buckets'], last['nano'], last['nanoByBucket'], last['priced'], -1)
            bucket = models.setdefault(last['key'], new_totals())
            apply_delta(bucket, last['buckets'], last['nano'], last['nanoByBucket'], last['priced'], -1)
        apply_delta(totals, buckets, nano, nano_by_bucket, priced, 1)
        apply_delta(periods[period], buckets, nano, nano_by_bucket, priced, 1)
        apply_delta(models.setdefault(key, new_totals()), buckets, nano, nano_by_bucket, priced, 1)
        last = {'turn': turn, 'step': step, 'period': period, 'key': key, 'priced': priced,
                'nano': nano, 'nanoByBucket': nano_by_bucket, 'buckets': buckets}

    result = {
        'events': len(events),
        'calls': totals['calls'],
        'unpricedCalls': totals['unpricedCalls'],
        'unpricedTokens': totals['unpricedTokens'],
        'nano': totals['nano'],
        'nanoYuan': totals['nano'] / NANO,
        'buckets': totals['buckets'],
        'nanoByBucket': totals['nanoByBucket'],
        'periods': {'peak': periods['peak']['nano'], 'offPeak': periods['offPeak']['nano']},
        'periodTokens': {
            'peak': sum(periods['peak']['buckets'].values()),
            'offPeak': sum(periods['offPeak']['buckets'].values()),
        },
        'models': {key: {'nano': value['nano'], 'calls': value['calls'],
                         'tokens': sum(value['buckets'].values())} for key, value in models.items()},
    }
    if '--json' in sys.argv:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"events={result['events']} calls={result['calls']} unpriced={result['unpricedCalls']}")
        print(f"nano={result['nano']} yuan={result['nanoYuan']:.6f}")
        print(f"peak={result['periods']['peak']} offPeak={result['periods']['offPeak']}")
        print(f"buckets={result['buckets']}")
        print(f"models={result['models']}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
