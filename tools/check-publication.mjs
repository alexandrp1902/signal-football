import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(process.argv[2]||fileURLToPath(new URL('../',import.meta.url)));
const files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const forbiddenPaths=/^(?:\.local\/|docs\/sessions\/|docs\/protocol-v1\.md$|tools\/hosting\/|tools\/deploy\.ps1$)|(?:^|\/)(?:id_rsa|id_ed25519)$|\.(?:pem|key|pfx|p12)$/i;
const patterns=[
  [/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/,'private key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/,'access token'],
  [/\bgithub_pat_[A-Za-z0-9_]{50,}\b/,'access token'],
  [/\bAKIA[A-Z0-9]{16}\b/,'cloud access key'],
  [/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{30,}\b/,'API key'],
  [/\broot@[a-z0-9][a-z0-9.-]+/i,'administrative host'],
  [/[a-z]:[\\/]+Users[\\/]+/i,'local user path'],
  [/\/etc\/(?:nginx|systemd|letsencrypt)\//i,'live service configuration'],
  [/\/opt\/[a-z0-9_-]+/i,'live service directory'],
  [/(?:sslip\.io|trycloudflare\.com)/i,'infrastructure hostname'],
];
let violations=0;
for(const file of files){
  const envFile=/(?:^|\/)\.env(?:$|\.)/i.test(file)&&!/(?:\.example|\.template)$/i.test(file);
  if(forbiddenPaths.test(file)||envFile){console.error(`${file}: private file must not be tracked`);violations++;continue;}
  const bytes=readFileSync(resolve(root,file));
  if(bytes.includes(0))continue;
  const body=bytes.toString('utf8');
  for(const [pattern,label]of patterns)if(pattern.test(body)){
    // Report the file and rule, never the matched value.
    console.error(`${file}: ${label}`);violations++;
  }
}
if(violations){console.error(`Publication check failed: ${violations} finding(s)`);process.exitCode=1;}
else console.log(`Publication check passed: ${files.length} tracked files`);
