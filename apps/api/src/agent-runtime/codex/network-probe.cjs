// Runs as the SAME identity and in the SAME namespace as Codex, including on
// every bridge launch. No task data or credentials are needed for this check.
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const dgram = require('node:dgram');
const dns = require('node:dns').promises;
const { spawnSync } = require('node:child_process');
const writable = (p) => { try { fs.accessSync(p, fs.constants.W_OK); return true; } catch { return false; } };
const denied = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 1500 });
  return result.status !== 0 && /not permitted|permission denied/i.test(result.stderr || '');
};
function tcp(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (code) => { socket.destroy(); resolve(code); };
    socket.once('connect', () => finish('CONNECTED'));
    socket.once('error', (error) => finish(error.code));
    socket.setTimeout(1200, () => finish('TIMEOUT'));
  });
}
function udp() {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    socket.send(Buffer.from('fementor-network-probe'), 53, '1.1.1.1', (error) => {
      socket.close(); resolve(error?.code || 'SENT');
    });
  });
}
async function main() {
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  const interfaces = Object.keys(os.networkInterfaces());
  const routes = fs.readFileSync('/proc/net/route', 'utf8').trim().split('\n').slice(1);
  const attempts = {};
  for (const [name, host, port] of [
    ['public_ipv4', '1.1.1.1', 443], ['public_ipv6', '2606:4700:4700::1111', 443],
    ['private_ipv4', '10.0.0.1', 5432], ['private_ipv6', 'fd00::1', 5432],
    ['metadata', '169.254.169.254', 80],
  ]) attempts[name] = await tcp(host, port);
  attempts.udp_dns = await udp();
  const resolver = new dns.Resolver({ timeout: 300, tries: 1 });
  resolver.setServers(['1.1.1.1']);
  attempts.dns = await resolver.resolve4('example.com').then(() => 'RESOLVED', (error) => error.code);
  const server = net.createServer((socket) => socket.end());
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const loopback = await tcp('127.0.0.1', server.address().port);
  await new Promise((resolve) => server.close(resolve));
  const proof = {
    uid: process.getuid(), noNewPrivileges: /NoNewPrivs:\s+1/.test(status),
    capabilitiesDropped: ['CapEff', 'CapPrm', 'CapBnd'].every((key) => new RegExp(`${key}:\\s+0+\\s`).test(status)),
    inputWritable: writable('/input'), capabilitiesWritable: writable('/capabilities'), workWritable: writable('/work'),
    credentialVariables: Object.keys(process.env).filter((key) => /TOKEN|KEY|DATABASE|RAILWAY/.test(key)),
    networkMode: 'loopback-only', interfaces, routes, attempts, loopback,
    routeChangeDenied: denied('ip', ['route', 'add', 'default', 'dev', 'lo']),
    namespaceReentryDenied: denied('nsenter', ['--net=/proc/1/ns/net', 'true']),
    privilegeEscalationDenied: denied('setpriv', ['--reuid=0', 'id']),
  };
  const unreachable = Object.entries(attempts).every(([name, code]) => name === 'dns'
    ? ['ECONNREFUSED', 'ETIMEOUT', 'ENETUNREACH'].includes(code)
    : code === 'ENETUNREACH');
  proof.egressDenied = interfaces.length === 1 && interfaces[0] === 'lo' && routes.length === 0 && unreachable;
  if (!process.argv.includes('--quiet')) console.log(JSON.stringify(proof));
  if (!proof.uid || !proof.noNewPrivileges || !proof.capabilitiesDropped || proof.inputWritable || proof.capabilitiesWritable
      || !proof.workWritable || proof.credentialVariables.length || !proof.egressDenied || loopback !== 'CONNECTED'
      || !proof.routeChangeDenied || !proof.namespaceReentryDenied || !proof.privilegeEscalationDenied) process.exitCode = 1;
}
main().catch(() => { process.exitCode = 1; });
