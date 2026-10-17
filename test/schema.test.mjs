import { test } from 'node:test'
import assert from 'node:assert/strict'
import { any, array, bool, int, literal, nullable, num, object, record, str, union } from '../src/shared/schema.js'

test('strict 对象：多字段、缺字段、类型不对都要报错并带路径', () => {
  const spec = object({ a: int(), b: object({ c: str() }) })
  assert.deepEqual(spec.parse({ a: 1, b: { c: 'x' } }), { a: 1, b: { c: 'x' } })
  assert.throws(() => spec.parse({ a: 1, b: { c: 'x' }, z: 1 }), /z 是未声明字段/)
  assert.throws(() => spec.parse({ a: 1 }), /b 缺失/)
  assert.throws(() => spec.parse({ a: 1, b: { c: 2 } }), /b\.c 应为字符串/)
  assert.throws(() => spec.parse({ a: -1, b: { c: 'x' } }), /非负安全整数/)
  assert.throws(() => spec.parse(null), /应为对象/)
  assert.throws(() => spec.parse([1]), /应为对象/)
})

test('数组、字典、nullable、union、literal', () => {
  assert.deepEqual(array(num()).parse([1, 2.5]), [1, 2.5])
  assert.throws(() => array(num()).parse([1, 'x']), /\[1\] 应为有限数字/)
  assert.deepEqual(record(int()).parse({ a: 1 }), { a: 1 })
  assert.throws(() => record(int()).parse({ a: 1.5 }), /a 应为非负安全整数/)
  assert.equal(nullable(str()).parse(null), null)
  assert.equal(nullable(str()).parse('x'), 'x')
  assert.equal(union([str(), int()]).parse(3), 3)
  assert.throws(() => union([str(), int()]).parse(true), /应为字符串/)
  assert.equal(literal(1).parse(1), 1)
  assert.throws(() => literal(1).parse(2), /应为 1/)
  assert.equal(bool().parse(true), true)
  assert.equal(any().parse({ anything: 1 }).anything, 1)
})

test('parse 返回新对象，不改输入', () => {
  const input = { a: 1, b: { c: 'x' } }
  const output = object({ a: int(), b: object({ c: str() }) }).parse(input)
  assert.notEqual(output, input)
  assert.notEqual(output.b, input.b)
})
