import type { Box3D, Vec3 } from './types';

export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const q = (v: number) => Math.round(v * 1000) / 1000;

/** 几何签名：用于判断框是否被改动、是否被插件自己改过 */
export function boxSignature(box: Pick<Box3D, 'center' | 'size' | 'yaw'>): string {
  const c: Vec3 = box.center;
  const s: Vec3 = box.size;
  return [
    q(c[0]), 
    q(c[1]),
    q(c[2]),
    q(s[0]),
    q(s[1]),
    q(s[2]),
    q(box.yaw)
  ].join(',');
}

export function boxKey(box: Pick<Box3D, 'id' | 'frameId' | 'trackId'>): string {
  return `${box.frameId ?? '-'}|${box.trackId ?? '-'}|${box.id}`;
}

export function shortId(input: string, len = 8): string {
  const h = fnv1a(input);
  return (h + '00000000').slice(0, len);
}
