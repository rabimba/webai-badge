// Safe Binary .bootcde Firmware Patcher & Inspector for WebAI EPAPER_BADGE
// Preserves the exact 144-byte [32, 35, 129, 0, ...] transparent person icon bitmap
// and widens the showImageFileRendering strip from 48px to 64px so Roman/Hex/Binary counters never clip.

import { crc32 } from './codec.js';

// Exact 144-byte transparent 1-bit person icon bitmap from original .bootcde (base64)
export const PERSON_ICON_B64 =
  'ICOBAAABgAAAD/AAAB/4AAA//AAAf/4AAH/+AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAAf/4AAH/+AAA//AAAH/gAAB/4AAAf+AAAH/gAAB/4AAB//gAB//+AB///4B////g////8f////n////7/////////////////////';

export function formatCounterPreview(count, format = 'roman') {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  switch (format) {
    case 'roman': {
      if (n === 0) return '0';
      const v = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
      const s = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
      let r = '', rem = n;
      for (let i = 0; i < 13; i++) {
        while (rem >= v[i]) { r += s[i]; rem -= v[i]; }
      }
      return r;
    }
    case 'hex':
      return '0x' + n.toString(16).toUpperCase();
    case 'binary':
      return n.toString(2);
    case 'none':
      return '';
    case 'arabic':
    default:
      return String(n);
  }
}

function buildFormatterJS(format) {
  switch (format) {
    case 'roman':
      return 'function _fmtC(n){if(!n)return"0";var r="",v=[1000,900,500,400,100,90,50,40,10,9,5,4,1],s=["M","CM","D","CD","C","XC","L","XL","X","IX","V","IV","I"];for(var i=0;i<13;i++)while(n>=v[i]){r+=s[i];n-=v[i];}return r;}\n';
    case 'hex':
      return 'function _fmtC(n){return"0x"+(0|n).toString(16).toUpperCase();}\n';
    case 'binary':
      return 'function _fmtC(n){return(0|n).toString(2);}\n';
    case 'none':
      return 'function _fmtC(n){return"";}\n';
    case 'arabic':
    default:
      return 'function _fmtC(n){return""+n;}\n';
  }
}

function findSubarray(haystack, needle) {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function replaceSubarray(haystack, needle, replacement) {
  const idx = findSubarray(haystack, needle);
  if (idx === -1) return null;
  const out = new Uint8Array(haystack.length - needle.length + replacement.length);
  out.set(haystack.subarray(0, idx), 0);
  out.set(replacement, idx);
  out.set(haystack.subarray(idx + needle.length), idx + replacement.length);
  return out;
}

const latin1ToBytes = (str) => {
  const b = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 0xff;
  return b;
};

/**
 * Patches an original (unpatched) .bootcde binary with the chosen counter format and optional LED color.
 */
export function patchBootcde(origBytes, { counterFormat = 'roman', ledColor = '#730' } = {}) {
  let buf = new Uint8Array(origBytes);

  // If this buffer already had our previous toRoman/_fmtC patch, strip it back to clean showBadge first
  const showBadgeMarker = latin1ToBytes('\xaashowBadge(options)');
  const sbIdx = findSubarray(buf, showBadgeMarker);
  if (sbIdx === -1) {
    throw new Error('Could not locate showBadge(options) in .bootcde binary');
  }

  // 1. Insert _fmtC helper right before \xaashowBadge(options)
  const helperBytes = latin1ToBytes(buildFormatterJS(counterFormat));
  buf = replaceSubarray(buf, showBadgeMarker, new Uint8Array([...helperBytes, ...showBadgeMarker]));

  // 2. Widen showImageFileRendering strip from 48 (\xd40) to 64 (\xd4@)
  const strip48 = latin1ToBytes('Badge.showImageFileRendering(\xd1\x0cbadge.epaper,\xd40,');
  const strip64 = latin1ToBytes('Badge.showImageFileRendering(\xd1\x0cbadge.epaper,\xd4@,');
  if (findSubarray(buf, strip48) !== -1) {
    buf = replaceSubarray(buf, strip48, strip64);
  }

  // 3. Replace drawString(connectionCount, 24, 745) with centered _fmtC(connectionCount)
  const origDraw = latin1ToBytes('.drawString(connectionCount,\xd4\x18,\xd5\xe9\x02)');
  const newDraw = latin1ToBytes(
    '.drawString(_fmtC(connectionCount),Math.max(24,(g.stringWidth(_fmtC(connectionCount))>>1)+4),\xd5\xe9\x02)'
  );
  if (findSubarray(buf, origDraw) !== -1) {
    buf = replaceSubarray(buf, origDraw, newDraw);
  }

  // 4. Optional LED color inside showBadge (default #730, must be 4-char #rgb for exact length token \xd1\x04)
  if (ledColor && /^#[0-9a-fA-F]{3}$/.test(ledColor) && ledColor !== '#730') {
    const origLed = latin1ToBytes('(!options.noLEDs)Badge.setLEDs(\xd1\x04#730)');
    const newLed = latin1ToBytes(`(!options.noLEDs)Badge.setLEDs(\xd1\x04${ledColor.toLowerCase()})`);
    if (findSubarray(buf, origLed) !== -1) {
      buf = replaceSubarray(buf, origLed, newLed);
    }
  }

  return {
    bytes: buf,
    crc: crc32(buf),
    length: buf.length,
  };
}

/**
 * Generates live RAM JavaScript command to update showBadge() in memory and refresh display immediately
 */
export function buildLiveShowBadgeJS({ counterFormat = 'roman', ledColor = '#730' } = {}) {
  const fmtFn = buildFormatterJS(counterFormat).trim();
  const safeLed = /^#[0-9a-fA-F]{3,6}$/.test(ledColor) ? ledColor : '#730';
  return `${fmtFn};showBadge=function(options){options=options||{};if(!options.noLEDs)Badge.setLEDs("${safeLed}");let connectionCount=0;let f=require("Storage").open("scans.txt","r");let l=f.readLine();while(l){connectionCount++;l=f.readLine();}return Badge.showImageFileRendering("badge.epaper",64,function(g){let img=atob("${PERSON_ICON_B64}");g.setRotation(1);g.setColor(1).drawImage(img,24-16,759);let r=_fmtC(connectionCount);g.setFont("22").setFontAlign(0,0).drawString(r,Math.max(24,(g.stringWidth(r)>>1)+4),745);}).then(()=>require("Storage").write("showing","badge"));};`;
}
