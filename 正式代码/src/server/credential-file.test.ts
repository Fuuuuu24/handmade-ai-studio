import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  emptyCredentialFile,
  hashToken,
  newRelayToken,
  normalizeKey,
  parseCredentialFile,
  parseMasterKey,
  seal,
  tokenMatches,
  unseal,
} from './credential-file';

const master = randomBytes(32);
const KEY = 'sk-test-0123456789abcdefTAIL';

describe('凭据文件的加解密（技术写法第 12.3 节）', () => {
  it('加密后能解回原文，密文里没有原文，每次 IV 不同', () => {
    const a = seal(master, 'aihubmix', KEY);
    const b = seal(master, 'aihubmix', KEY);
    expect(unseal(master, 'aihubmix', a)).toBe(KEY);
    expect(JSON.stringify(a)).not.toContain(KEY);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it('主密钥不对、密文或校验码被改、挪到别的供应商下都解不开', () => {
    const box = seal(master, 'aihubmix', KEY);
    expect(() => unseal(randomBytes(32), 'aihubmix', box)).toThrow('解密失败');
    const flipped = Buffer.from(box.data, 'base64');
    flipped[0] ^= 1;
    expect(() => unseal(master, 'aihubmix', { ...box, data: flipped.toString('base64') })).toThrow('解密失败');
    expect(() => unseal(master, 'aihubmix', { ...box, tag: randomBytes(16).toString('base64') })).toThrow('解密失败');
    expect(() => unseal(master, 'other', box)).toThrow('解密失败');
  });

  it('主密钥缺失或长度不对时报错', () => {
    expect(() => parseMasterKey(undefined)).toThrow('没有设置主密钥');
    expect(() => parseMasterKey('  ')).toThrow('没有设置主密钥');
    expect(() => parseMasterKey(randomBytes(16).toString('base64'))).toThrow('长度不对');
    expect(parseMasterKey(` ${master.toString('base64')} `).equals(master)).toBe(true);
  });
});

describe('录入检查与团队口令', () => {
  it('key 去首尾空白；太短、太长、中间有空白都拒绝', () => {
    expect(normalizeKey(`  ${KEY}\n`)).toBe(KEY);
    expect(() => normalizeKey('sk-short')).toThrow('16—256');
    expect(() => normalizeKey('x'.repeat(257))).toThrow('16—256');
    expect(() => normalizeKey('sk-abc def-0123456789')).toThrow('空格');
    expect(() => normalizeKey(undefined)).toThrow('16—256');
  });

  it('口令只按散列比对：对的通过，错的、空的、散列长度不对都不通过', () => {
    const token = newRelayToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newRelayToken()).not.toBe(token);
    const sha = hashToken(token);
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenMatches(token, sha)).toBe(true);
    expect(tokenMatches(`${token}x`, sha)).toBe(false);
    expect(tokenMatches('', sha)).toBe(false);
    expect(tokenMatches(token, 'abcd')).toBe(false);
  });
});

describe('凭据文件结构校验', () => {
  const valid = () => ({
    ...emptyCredentialFile(),
    revision: 2,
    providers: { aihubmix: { status: 'active', key: { ...seal(master, 'aihubmix', KEY), last4: 'TAIL', savedAt: '2026-11-01T00:00:00.000Z' } } },
    relay: { status: 'active', sha256: hashToken('t'), last4: 'abcd', createdAt: '2026-11-01T00:00:00.000Z' },
  });

  it('合法文件读得出来，缺省的上一把 key 记为 null', () => {
    const file = parseCredentialFile(JSON.stringify(valid()));
    expect(file.revision).toBe(2);
    expect(file.providers.aihubmix?.previous).toBeNull();
    expect(parseCredentialFile(JSON.stringify(emptyCredentialFile())).relay).toBeNull();
  });

  it('坏文件直接报错，不当成空文件', () => {
    expect(() => parseCredentialFile('{不是 JSON')).toThrow('不是有效的 JSON');
    expect(() => parseCredentialFile('[]')).toThrow('不是对象');
    expect(() => parseCredentialFile(JSON.stringify({ ...valid(), schemaVersion: 2 }))).toThrow('不认识的版本');
    expect(() => parseCredentialFile(JSON.stringify({ ...valid(), revision: -1 }))).toThrow('revision');
    expect(() => parseCredentialFile(JSON.stringify({ ...valid(), providers: { other: valid().providers.aihubmix } }))).toThrow('不认识的供应商');
    const noKey = valid() as unknown as { providers: { aihubmix: { key: Record<string, unknown> } } };
    delete noKey.providers.aihubmix.key.tag;
    expect(() => parseCredentialFile(JSON.stringify(noKey))).toThrow('aihubmix.key');
    expect(() => parseCredentialFile(JSON.stringify({ ...valid(), relay: { ...valid().relay, sha256: 'xyz' } }))).toThrow('relay');
    expect(() => parseCredentialFile(JSON.stringify({ ...valid(), log: {} }))).toThrow('log');
  });
});
