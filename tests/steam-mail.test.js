import assert from 'node:assert/strict';
import test from 'node:test';
import { extractSteamGuardCode, extractSteamRecoveryLink } from '../server/steam-mail.js';

const mainlandText = 'gracelykrinke9613，\n看起来您正在尝试使用新设备登录。此处是您访问帐户所需的 Steam 令牌验证码：\n请求来自\n中国（大陆）\nNYV2X\n不是您？\n您会收到这封电子邮件，是由于有人试图登录您的 Steam 帐户，且提供了正确的帐户名称与密码。\n如果这不是您尝试登录，建议您重置自己的 Steam 密码。';
const guard = (text, subject = '您的 Steam 账号：来自新设备的访问') => ({ subject, text });

test('Taiwan account / simplified Chinese mainland login preserves the real NYV2X code', () => {
  assert.equal(extractSteamGuardCode(guard(mainlandText)), 'NYV2X');
  assert.equal(extractSteamRecoveryLink(guard(mainlandText)), '');
});

test('nested HTML tables, blank rows, entities and inline spans preserve the code', () => {
  const html = `<html><head><style>.STEAM { color: red; }</style></head><body><table>
    <tr><td>gracelykrinke9613，</td></tr>
    <tr><td>看起来您正在尝试使用新设备登录。此处是您访问帐户所需的 Steam 令牌验证码：</td></tr>
    ${'<tr><td>&nbsp;</td></tr>\n'.repeat(40)}
    <tr><td><table><tr><td>请求来自</td></tr><tr><td>中国（大陆）</td></tr></table></td></tr>
    <tr><td><span>N</span><span>YV</span><b>2X</b></td></tr>
    <tr><td>不是您？</td></tr><tr><td><a href="https://help.steampowered.com/zh-cn/wizard/HelpWithLogin">重置自己的 Steam 密码</a></td></tr>
    </table></body></html>`;
  assert.equal(extractSteamGuardCode({ html }), 'NYV2X');
  assert.equal(extractSteamRecoveryLink({ html }), '');
});

for (const [language, text, expected] of [
  ['traditional Chinese', '您正在嘗試從新的裝置登入。以下是您的 Steam Guard 驗證碼：\n請求來自\n台灣\nAB7CD', 'AB7CD'],
  ['Japanese', '新しいデバイスからログインしようとしています。Steam ガードコード：\nリクエスト元：\n日本\nK7X9P', 'K7X9P'],
  ['English', 'You are logging in from a new device. Here is your Steam Guard code:\nRequest from:\nUnited States\nA1B2C', 'A1B2C'],
  ['Korean', '새 기기에서 Steam 로그인 시도. 보안 코드:\n요청 위치:\n대한민국\n7B8C9', '7B8C9'],
  ['French', 'Nouvelle connexion Steam. Votre code de connexion :\nOrigine de la demande :\nFrance\nD3E4F', 'D3E4F'],
  ['German', 'Neue Steam Anmeldung. Ihr Sicherheitscode:\nDeutschland\nG5H6J', 'G5H6J'],
  ['Spanish', 'Nuevo inicio de sesión en Steam. Su código de acceso:\nOrigen de la solicitud:\nEspaña\nK7L8M', 'K7L8M'],
  ['Russian', 'Попытка входа в Steam. Ваш код:\nИсточник запроса:\nРоссия\nN9P2Q', 'N9P2Q'],
  ['Italian', 'Per accedere al tuo account Steam, il codice è:\nItalia\nR3T4V', 'R3T4V']
]) {
  test(`${language} login email`, () => assert.equal(extractSteamGuardCode({ text }), expected));
}

test('Steam Guard code does not depend on a login/origin phrase', () => {
  assert.equal(extractSteamGuardCode({ text: 'Your Steam Guard code is: ABCDE' }), 'ABCDE');
  assert.equal(extractSteamGuardCode({ subject: 'Your Steam Guard code', text: '12345' }), '12345');
  assert.equal(extractSteamGuardCode({ text: 'Steam 令牌验证码：00012' }), '00012');
});

test('inline English code at the end of the access-account sentence', () => {
  assert.equal(extractSteamGuardCode({ text: 'Here is the Steam Guard code you need to access your account: NYV2X' }), 'NYV2X');
  assert.equal(extractSteamGuardCode({ text: 'Your Steam Guard code is: QWERT. Enter this code to log in.' }), 'QWERT');
});

test('all-letter code survives after any location, even a five-letter uppercase location', () => {
  for (const country of ['中国（大陆）', 'Taiwan', 'JAPAN', 'CHILE', 'UNKNOWN PLACE']) {
    assert.equal(extractSteamGuardCode({ text: `Steam Guard code:\nRequest from:\n${country}\nQWERT\nNot you?` }), 'QWERT');
  }
});

test('numeric codes, inline country and HTML numeric entities', () => {
  assert.equal(extractSteamGuardCode({ text: 'Steam Guard code:\nRequest from: 中国（大陆）\n12345' }), '12345');
  assert.equal(extractSteamGuardCode({ html: '<p>Steam Guard code:</p><p>&#78;&#x59;V2X</p>' }), 'NYV2X');
  assert.equal(extractSteamGuardCode({ html: '<p>Steam Guard code: &#x110000;</p>' }), '');
});

test('explicit code wins over later URL tokens and the warning footer', () => {
  assert.equal(extractSteamGuardCode({ text: `${mainlandText}\nhttps://help.steampowered.com/?token=ZZZZZ\nABCDE` }), 'NYV2X');
  assert.equal(extractSteamGuardCode({ text: 'Your Steam Guard code is: ABCDE\nhttps://example.com/?code=12345' }), 'ABCDE');
});

for (const [reason, message] of [
  ['no Steam context', { text: 'Your login verification code:\n12345' }],
  ['URL query token', { text: 'Steam Guard code:\nhttps://help.steampowered.com/?token=NYV2X' }],
  ['HTML href token', { html: '<p>Steam Guard code:</p><a href="https://example.com/?token=NYV2X">NYV2X</a>' }],
  ['five-character account name in greeting', { text: 'ABCDE，\nYour Steam Guard code:\nNot you?' }],
  ['account field', { subject: 'Steam Guard code', text: 'Account name:\nABCDE\nNo code available.' }],
  ['account field without punctuation', { subject: 'Steam Guard code', text: 'Account name\nABCDE' }],
  ['standalone username before the body code label', { subject: 'Steam Guard code', text: 'ABCDE\nYour Steam Guard code:\nNot you?' }],
  ['inline account name', { text: 'Steam Guard code for account ABCDE' }],
  ['inline account name after colon', { text: 'Steam Guard code for account: ABCDE' }],
  ['email local part', { text: 'Steam Guard code:\nABCDE@example.com' }],
  ['word embedded in prose', { text: 'Steam Guard code:\nPlease CLICK the EMAIL above.' }],
  ['standalone navigation words', { text: 'Steam Guard code:\nSTEAM\nGUARD\nEMAIL\nCLICK\nLOGIN\nRESET\nWORLD' }],
  ['lowercase five-letter word', { text: 'Steam Guard code:\nhello' }],
  ['longer numeric identifier', { text: 'Steam Guard code:\n123456789' }],
  ['longer account name containing a token', { text: 'Steam Guard code: user_NYV2X' }],
  ['uppercase five-letter location alone', { text: 'Steam Guard code:\nRequest from:\nJAPAN\nNot you?' }],
  ['code too far from code label', { text: `Steam Guard code:\n${'unrelated paragraph\n'.repeat(30)}NYV2X` }],
  ['recovery email', { text: 'Steam Account Recovery. Steam Guard code:\n12345\nhttps://help.steampowered.com/en/wizard/VerifyCode?c=ABCD&account=123' }],
  ['missing message', undefined],
  ['null message', null]
]) {
  test(`does not extract ${reason}`, () => assert.equal(extractSteamGuardCode(message), ''));
}

for (const language of ['en', 'ja', 'zh-cn', 'zh-tw', 'schinese', 'tchinese', 'pt-br', 'es-419']) {
  test(`recovery URL supports ${language} path without language keywords`, () => {
    const url = `https://help.steampowered.com/${language}/wizard/VerifyCode?c=ABC123&account=123456`;
    assert.equal(extractSteamRecoveryLink({ text: url }), url);
  });
}

test('recovery HTML entities and punctuation', () => {
  assert.equal(extractSteamRecoveryLink({ html: '<a href="https://help.steampowered.com/zh-tw/wizard/VerifyCode?c=ABC123&amp;account=123456">繼續恢復</a>' }), 'https://help.steampowered.com/zh-tw/wizard/VerifyCode?c=ABC123&account=123456');
  assert.equal(extractSteamRecoveryLink({ text: '(https://help.steampowered.com/en/wizard/VerifyCode?c=ABC123).' }), 'https://help.steampowered.com/en/wizard/VerifyCode?c=ABC123');
});

test('Microsoft Safe Links return the actual Steam recovery URL', () => {
  const target = 'https://help.steampowered.com/zh-cn/wizard/VerifyCode?c=123ABC&account=456';
  const wrapped = `https://nam12.safelinks.protection.outlook.com/?url=${encodeURIComponent(target)}&data=ignored`;
  assert.equal(extractSteamRecoveryLink({ text: wrapped }), target);
  assert.equal(extractSteamRecoveryLink({ html: `<a href="${wrapped.replaceAll('&', '&amp;')}">重置密码</a>` }), target);
  const nested = `https://eur01.safelinks.protection.outlook.com/?url=${encodeURIComponent(wrapped)}`;
  assert.equal(extractSteamRecoveryLink({ text: nested }), target);
});

for (const url of [
  'https://help.steampowered.com/en/wizard/HelpWithLogin',
  'https://help.steampowered.com/zh-cn/wizard/HelpUnauthorizedLogin?c=ABC123',
  'https://help.steampowered.com/en/wizard/VerifyCode',
  'https://help.steampowered.com/en/wizard/VerifyCode?c=',
  'https://help.steampowered.com/en/wizard/VerifyCode?c=%20',
  'https://help.steampowered.com/en/wizard/VerifyCode?c=A&c=B',
  'https://help.steampowered.com/en/wizard/VerifyCode?c=https%3A%2F%2Fevil.example',
  'https://help.steampowered.com/en/wizard/VerifyCodeOther?c=ABC123',
  'https://help.steampowered.com.evil.example/en/wizard/VerifyCode?c=ABC123',
  'https://help.steampowered.com@evil.example/en/wizard/VerifyCode?c=ABC123',
  'https://user@help.steampowered.com/en/wizard/VerifyCode?c=ABC123',
  'https://help.steampowered.com:444/en/wizard/VerifyCode?c=ABC123',
  'http://help.steampowered.com/en/wizard/VerifyCode?c=ABC123',
  `https://safelinks.protection.outlook.com.evil.example/?url=${encodeURIComponent('https://help.steampowered.com/en/wizard/VerifyCode?c=ABC123')}`,
  `https://nam01.safelinks.protection.outlook.com/?url=${encodeURIComponent('https://evil.example/en/wizard/VerifyCode?c=ABC123')}`,
  `https://nam01.safelinks.protection.outlook.com/?url=${encodeURIComponent('https://help.steampowered.com/en/wizard/HelpWithLogin?c=ABC123')}`
]) {
  test(`rejects a generic or untrusted recovery URL: ${url}`, () => {
    assert.equal(extractSteamRecoveryLink({ text: `Steam password reset\n${url}` }), '');
  });
}

test('login warning links never become password reset links', () => {
  const message = guard(`${mainlandText}\nhttps://help.steampowered.com/zh-cn/wizard/HelpWithLogin\nhttps://help.steampowered.com/zh-cn/wizard/HelpUnauthorizedLogin`);
  assert.equal(extractSteamRecoveryLink(message), '');
  assert.equal(extractSteamGuardCode(message), 'NYV2X');
});

test('missing recovery message returns an empty result', () => {
  assert.equal(extractSteamRecoveryLink(), '');
  assert.equal(extractSteamRecoveryLink(null), '');
});
