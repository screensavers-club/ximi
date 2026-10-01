# XIMI offline certificates

Offline (LAN) XIMI serves every app over HTTPS on its own hostname
(`control.ximi.offline`, `performer.ximi.offline`, ...). Browsers only allow
camera and microphone on secure origins, so this is required, not optional.

The certificates come from a private certificate authority (CA): the "XIMI
Offline CA". Client devices trust that CA once, and then trust any host
machine running XIMI offline.

## Files

| File | Secret? | In git | Purpose |
|---|---|---|---|
| `ximi-ca.crt` | no | yes | The CA certificate. Install on every **client** device. Also used by the XIMI server (`NODE_EXTRA_CA_CERTS` in `start:offline`) to trust `https://livekit.ximi.offline`. Valid until 2036. |
| `ximi-ca.key` | **yes** | **no** | The CA private key. Only needed to issue new certificates. Keep it in a password manager. |
| `ximi.offline.crt` | no | yes | Server certificate for all `*.ximi.offline` hostnames. Caddy serves it. Valid for 825 days. |
| `ximi.offline.key` | yes (limited) | yes | Private key for the server certificate. Every host needs it. It only works for the `*.ximi.offline` names below. |
| `ximi.offline.ext` | no | yes | Hostnames and usages baked into the server certificate. |
| `ximi.offline.csr` | no | yes | Certificate signing request, reused when renewing. |
| `ximi-ca.srl` | no | yes | Serial number counter for certificates issued by the CA. |

Hostnames covered (see `ximi.offline.ext`): `control`, `performer`, `scout`,
`output`, `server`, `livekit`, `turn` `.ximi.offline`.

## Check expiry

```sh
openssl x509 -in certs/ximi.offline.crt -noout -enddate   # server certificate
openssl x509 -in certs/ximi-ca.crt -noout -enddate        # CA
```

## Client devices: trust the CA (once per device)

Copy `ximi-ca.crt` to the device (AirDrop, USB, or serve it from a host).

- **macOS**: double-click it, then in Keychain Access set it to
  *Always Trust*. Or:
  `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain certs/ximi-ca.crt`
- **iOS / iPadOS**: open it to install the profile (Settings > Profile
  Downloaded > Install), **then** enable it under Settings > General >
  About > Certificate Trust Settings. The second step is easy to miss.
- **Android**: Settings > Security > Encryption & credentials > Install a
  certificate > CA certificate. Chrome trusts user-installed CAs.
- **Windows**: double-click > Install Certificate > Local Machine >
  *Trusted Root Certification Authorities*.

Firefox uses its own trust store: Settings > Privacy & Security >
Certificates > View Certificates > Authorities > Import.

## Host machines: install or replace the certificate

A host only needs `ximi-ca.crt`, `ximi.offline.crt` and `ximi.offline.key`
in this folder. They come with the repo; after a renewal, pull (or copy the
three files over) and restart:

1. Put the files in `certs/`.
2. Restart Caddy so it serves the new certificate
   (`caddy reload --config apps/server/setup/ximi-local.Caddyfile`).
3. Restart the XIMI server (`pnpm --filter server start:offline`) if
   `ximi-ca.crt` changed.

Renewing the server certificate with the same CA needs **no** changes on
client devices. Only a new CA does.

Note: `apps/server/setup/ximi-local.Caddyfile` currently points at absolute
paths under `/Users/siah/Dev/ximi/certs`. Adjust them on other machines.

## Renew the server certificate (same CA)

Do this before `ximi.offline.crt` expires, or after adding a hostname to
`ximi.offline.ext`. Needs `ximi-ca.key` (restore it from the password
manager into `certs/`). Run from the repo root:

```sh
cd certs
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out ximi.offline.key
openssl req -new -key ximi.offline.key \
  -subj "/C=SG/O=Screensavers Pte Ltd/CN=ximi.offline" -out ximi.offline.csr
openssl x509 -req -in ximi.offline.csr -CA ximi-ca.crt -CAkey ximi-ca.key \
  -CAcreateserial -sha256 -days 825 -extfile ximi.offline.ext -out ximi.offline.crt
openssl verify -CAfile ximi-ca.crt ximi.offline.crt   # expect: OK
```

Keep `-days` at 825 or less: iOS and macOS reject longer-lived server
certificates. `ximi.offline.ext` must keep `extendedKeyUsage = serverAuth`
and the `subjectAltName` list, or iOS rejects the certificate.

Then commit the new `.crt`, `.key`, `.csr` and `.srl`, and follow "Host
machines" above. Delete `ximi-ca.key` from `certs/` again afterwards
(it is gitignored, but keep the only copy somewhere safe).

## Replace the CA (start over)

Only if `ximi-ca.key` is lost or leaked, or the CA expires. **Every client
device must then trust the new `ximi-ca.crt`** (and should remove the old
one). Run from the repo root:

```sh
cd certs
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out ximi-ca.key
openssl req -x509 -new -key ximi-ca.key -sha256 -days 3650 \
  -subj "/C=SG/O=Screensavers Pte Ltd/CN=XIMI Offline CA" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -addext "subjectKeyIdentifier=hash" \
  -out ximi-ca.crt
```

Then run "Renew the server certificate" above to issue a server certificate
from the new CA, store `ximi-ca.key` in the password manager, and commit the
rest.

## Test a certificate without a full setup

```sh
# terminal 1
openssl s_server -accept 18443 -cert certs/ximi.offline.crt -key certs/ximi.offline.key -www
# terminal 2 - expect 200
curl --cacert certs/ximi-ca.crt --resolve control.ximi.offline:18443:127.0.0.1 \
  https://control.ximi.offline:18443/ -o /dev/null -w "%{http_code}\n"
```
