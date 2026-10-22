// Mail content is already decoded by Graph/mailparser. Keep this module pure so
// the same parsing rules can be exercised without a mailbox or the HTTP server.
const guardName = /Steam\s*(?:Guard|ガード|令牌|安全)|ガードコード/i;
const codeLabel = /\b(?:code|passcode|otp|c[oó]digo|codice|sicherheitscode|anmeldecode)\b|验证码|驗證碼|安全代码|安全代碼|安全码|安全碼|登录码|登入碼|令牌码|令牌碼|动态码|動態碼|コード|보안\s*코드|가드\s*코드|인증\s*코드|код(?:а|ом)?(?!\p{L})/iu;
const loginSignal = /log[ -]?in|sign[ -]?in|access.{0,60}account|new.{0,30}(?:device|browser)|登录|登陆|登入|新(?:的)?设备|新(?:的)?裝置|ログイン|로그인|connexion|inicio.{0,20}sesi[oó]n|iniciar.{0,20}sesi[oó]n|anmeld|accedere|acesso|вход|войти/iu;
const originLabel = /リクエスト元\s*[:：]?|request\s*(?:origin|from)\s*[:：]?|请求.{0,8}(?:来自|来源|源)\s*[:：]?|請求.{0,8}(?:來自|來源|源)\s*[:：]?|(?:登录|登入).{0,8}(?:地点|位置|地點)\s*[:：]?|요청.{0,8}(?:위치|출처)\s*[:：]?|origine.{0,20}(?:demande|requête|richiesta)\s*[:：]?|provenance\s*[:：]?|origen.{0,20}(?:solicitud|petición)\s*[:：]?|procedencia\s*[:：]?|anforderungs.{0,12}(?:ort|ursprung)\s*[:：]?|anfrage.{0,12}(?:ort|ursprung)\s*[:：]?|источник.{0,20}запрос[а]?\s*[:：]?|место.{0,20}запрос[а]?\s*[:：]?/iu;
const footerStart = /^(?:not\s+you\b|wasn['’]?t\s+you\b|不是您|不是你|並非您|并非您|心当たり|ご自身でない|본인이|ce\s+n['’]est\s+pas\s+vous|no\s+has\s+sido\s+t[uú]|nicht\s+sie\b)/iu;
const accountLabel = /(?:account|user)\s*(?:name|id)|(?:帐户|账户|账号|帐号|帳戶|帳號|賬號|用戶|用户)(?:名|名称|名稱)?|アカウント名|계정\s*이름/iu;
// These are email/UI words, not a country list. A location is excluded by its
// position under the request-origin label, regardless of its language or value.
const ordinaryWords = new Set([
  'ABOUT', 'ABOVE', 'AFTER', 'AGAIN', 'ALERT', 'BELOW', 'CHECK', 'CLICK',
  'CLOSE', 'CODES', 'EMAIL', 'ENTER', 'FIRST', 'GUARD', 'HELLO', 'HTTPS',
  'LATER', 'LEARN', 'LOGIN', 'NEVER', 'OTHER', 'PRESS', 'QUICK', 'RESET',
  'RIGHT', 'SHARE', 'START', 'STEAM', 'STILL', 'STORE', 'THANK', 'THEIR', 'THERE',
  'THESE', 'THOSE', 'TOKEN', 'USING', 'VALVE', 'VISIT', 'WHERE', 'WHICH',
  'WORLD', 'WOULD', 'YOURS'
]);

function decodeHtmlEntities(value) {
  const entities = { amp: '&', nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', sol: '/', equals: '=', tab: '\t', newline: '\n' };
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, key) => {
    if (key[0] !== '#') return entities[key.toLowerCase()] ?? entity;
    const number = /^#x/i.test(key) ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
      ? String.fromCodePoint(number) : entity;
  });
}

function contentLines(value, html = false) {
  let text = String(value || '');
  if (html) {
    text = text
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      // Link labels can repeat a query token, account name, or navigation word.
      .replace(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi, ' ')
      .replace(/<\/?(?:br|p|div|li|tr|td|th|table|h[1-6])\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '');
  }
  return decodeHtmlEntities(text)
    .replace(/https?:\/\/[^\s<>"']+/gi, ' ')
    .replace(/\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .split(/\r\n?|\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function usableCode(token) {
  return /^[A-Z0-9]{5}$/.test(token) && !ordinaryWords.has(token);
}

function explicitLineCode(line) {
  for (const match of line.matchAll(/(?<![A-Za-z0-9_@])([A-Z0-9]{5})(?![A-Za-z0-9_@])/g)) {
    if (!usableCode(match[1])) continue;
    const prefix = line.slice(0, match.index).trimEnd();
    const suffix = line.slice(match.index + match[0].length);
    if (!codeLabel.test(prefix) && !guardName.test(prefix)) continue;
    if (!/^[\s.!。！)\]）]*$/.test(suffix) && !/^[.!。！]\s+/.test(suffix)) continue;
    if (/(?:\b(?:account|user)\s*(?:name|id)|\b(?:for|of)\s+(?:your\s+)?(?:account|user))\s*[:：]?\s*$/i.test(prefix)) continue;
    const lastWord = prefix.match(/[^\s:：=]+$/)?.[0] || '';
    if (/[:：=]\s*$/.test(prefix) || /(?:\b(?:is|ist|est|es|è|é)|为|為|は)\s*$/iu.test(prefix) || codeLabel.test(lastWord)) {
      return match[1];
    }
  }
  return '';
}

export function isSteamLoginMessage(message) {
  const subject = contentLines(message?.subject).join('\n');
  const context = [subject, ...contentLines(message?.text), ...contentLines(message?.html, true)].join('\n');
  if (!/Steam/i.test(context) || extractSteamRecoveryLink(message)) return false;
  return guardName.test(subject)
    || (codeLabel.test(context) && (loginSignal.test(context) || originLabel.test(context)))
    || /来自新(?:网页|设备|移动设备)|來自新(?:網頁|裝置|行動裝置)|new.{0,30}(?:device|browser|web|mobile)/iu.test(subject);
}

export function extractSteamGuardCode(message) {
  const subject = contentLines(message?.subject);
  const bodies = [contentLines(message?.text), contentLines(message?.html, true)].filter((lines) => lines.length);
  const context = [...subject, ...bodies.flat()].join('\n');
  if (!/Steam/i.test(context)) return '';
  if (!guardName.test(context) && !(codeLabel.test(context) && (loginSignal.test(context) || originLabel.test(context)))) return '';
  // Recovery emails sometimes also mention Steam Guard in their help/footer.
  if (extractSteamRecoveryLink(message)) return '';

  const candidates = [];
  for (const lines of [subject, ...bodies]) {
    let marker = -1;
    let distance = 0;
    let inOrigin = false;
    let skipOriginValue = false;
    let skipAccountValue = false;
    const subjectHasMarker = subject.some((line) => codeLabel.test(line) || guardName.test(line));
    const bodyHasMarker = lines.some((line) => codeLabel.test(line) || guardName.test(line));
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (footerStart.test(line)) break;
      const direct = explicitLineCode(line);
      if (direct) candidates.push({ code: direct, score: 120 });

      if (codeLabel.test(line) || guardName.test(line)) {
        marker = index;
        distance = 0;
      } else {
        distance += line.length;
      }
      const origin = line.match(originLabel);
      if (origin) {
        inOrigin = true;
        // The first location value may itself be five uppercase letters.
        skipOriginValue = !line.slice(origin.index + origin[0].length).trim();
        continue;
      }
      if (skipOriginValue) {
        skipOriginValue = false;
        // A mixed or numeric code cannot be a country name. Keep it eligible
        // when a stripped flag/image was the only location representation.
        if (!/^(?=.*\d)[A-Z0-9]{5}$/.test(line)) continue;
      }
      if (skipAccountValue) {
        skipAccountValue = false;
        if (!codeLabel.test(line) && !guardName.test(line)) continue;
      }
      if (accountLabel.test(line) && !codeLabel.test(line) && !guardName.test(line)) {
        skipAccountValue = /[:：]\s*$/.test(line) || line.replace(accountLabel, '').replace(/\byour\b|\bsteam\b|您(?:的)?|你(?:的)?/gi, '').trim() === '';
        continue;
      }

      const token = line.match(/^[[(（]?([A-Z0-9]{5})[\])）]?$/)?.[1];
      if (!token || !usableCode(token)) continue;
      // Do not scan arbitrary prose for five-character words. Require a code
      // label before a standalone token, with a bounded content (not blank-line) window.
      if (marker < 0 && (!subjectHasMarker || bodyHasMarker)) continue;
      if (index - marker > 20 || distance > 1400) continue;
      candidates.push({ code: token, score: (marker >= 0 ? 80 : 40) + (inOrigin ? 15 : 0) - Math.min(index - marker, 20) });
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.code || '';
}

function parseRecoveryCandidate(candidate) {
  let value = decodeHtmlEntities(candidate).trim().replace(/[)\].,;，。]+$/g, '');
  for (let depth = 0; depth < 4; depth += 1) {
    let url;
    try { url = new URL(value); } catch { return ''; }
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return '';
    const host = url.hostname.toLowerCase();
    if (host === 'safelinks.protection.outlook.com' || host.endsWith('.safelinks.protection.outlook.com')) {
      value = url.searchParams.get('url') || '';
      if (!value) return '';
      continue;
    }
    if (host !== 'help.steampowered.com') return '';
    // Language varies with the account/email, independently of the login IP.
    if (!/^\/(?:[a-z][a-z0-9-]*\/)?wizard\/VerifyCode\/?$/i.test(url.pathname)) return '';
    const codes = url.searchParams.getAll('c');
    if (codes.length !== 1 || !/^[A-Za-z0-9_-]+$/.test(codes[0])) return '';
    return url.toString();
  }
  return '';
}

export function extractSteamRecoveryLink(message) {
  const raw = decodeHtmlEntities([message?.subject, message?.text, message?.html].filter(Boolean).join('\n'));
  for (const candidate of raw.match(/https?:\/\/[^\s"'<>]+/gi) || []) {
    const link = parseRecoveryCandidate(candidate);
    if (link) return link;
  }
  return '';
}
