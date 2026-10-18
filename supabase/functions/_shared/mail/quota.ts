/** RFC 9208: STORAGE units are 1024 octets; multiple roots use the tightest quota. */
export function parseStorageQuota(lines: string[]): {usedBytes:number;limitBytes:number}|null {
  const quotas=lines.filter(line=>/^\* QUOTA /i.test(line)).flatMap(line=>{
    const match=line.match(/\bSTORAGE\s+(\d+)\s+(\d+)/i);
    if(!match)return [];
    const usedBytes=Number(match[1])*1024,limitBytes=Number(match[2])*1024;
    return Number.isSafeInteger(usedBytes)&&Number.isSafeInteger(limitBytes)&&limitBytes>0?[{usedBytes,limitBytes}]:[];
  });
  return quotas.sort((a,b)=>b.usedBytes/b.limitBytes-a.usedBytes/a.limitBytes)[0]??null;
}
