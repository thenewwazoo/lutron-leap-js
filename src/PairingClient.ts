import { ConnectionOptions, TLSSocket, connect, createSecureContext } from 'tls';
import debug from 'debug';
import { EventEmitter } from 'events';

import TypedEmitter from 'typed-emitter';

import { assocCert, assocKey, assocCACert } from './Association';

const logDebug = debug('leap:pairing');

type PairingEvents = {
    message: (response: object) => void;
    disconnected: () => void;
};

export class PairingClient extends (EventEmitter as new () => TypedEmitter<PairingEvents>) {
    private connected: Promise<void> | null;

    private socket?: TLSSocket;
    private readonly tlsOptions: ConnectionOptions;

    private buffer: string;

    constructor(private readonly host: string, private readonly port: number) {
        super();
        logDebug('new PairingClient being constructed');
        this.connected = null;
        this.buffer = '';
        const context = createSecureContext({
            ca: assocCACert,
            key: assocKey,
            cert: assocCert,
        });

        this.tlsOptions = {
            secureContext: context,
            secureProtocol: 'TLSv1_2_method',
            rejectUnauthorized: false,
        };
    }

    public connect(): Promise<void> {
        if (!this.connected) {
            logDebug('needs to connect');
            this.connected = new Promise((resolve, reject) => {
                logDebug('about to connect');

                this.socket = connect(this.port, this.host, this.tlsOptions, () => {
                    logDebug('connected!');
                });

                this.socket.once('secureConnect', () => {
                    logDebug('securely connected');
                    resolve();
                });

                this.socket.once('error', (e) => {
                    logDebug('connection failed: ', e);
                    this.connected = null;
                    delete this.socket;
                    reject(e);
                });

                this.socket.once('close', () => (sock: TLSSocket) => {
                    logDebug('client socket has closed.');
                    this.connected = null;
                    delete this.socket;
                    this.emit('disconnected');
                });

                this.socket.on('data', this.socketDataHandler.bind(this));
            });
        }

        return this.connected;
    }

    public async requestPair(csrText: string) {
        await this.connect();

        const tag = 'get-cert';

        // special not-quite-LEAP format just for CSRs
        const message = {
            Header: {
                RequestType: 'Execute',
                Url: '/pair',
                ClientTag: 'get-cert',
            },
            Body: {
                CommandType: 'CSR',
                Parameters: {
                    CSR: csrText,
                    DisplayName: 'get_lutron_cert.py',
                    DeviceUID: '000000000000',
                    Role: 'Admin',
                },
            },
        };

        const msg = JSON.stringify(message);
        logDebug('request handler about to write:', msg);
        this.socket?.write(msg + '\n', () => {
            logDebug('sent request tag', tag, ' successfully');
        });
    }

    private socketDataHandler(data: Buffer): void {
        const s = data.toString();
        logDebug('got data from socket:', s);
        try {
            logDebug('parsing line', s);
            this.emit('message', JSON.parse(s));
        } catch (e) {
            logDebug('malformed response:', e, ' caused by', s);
        }
    }
}

/*

Reference messages
===

Button pressed
---

'{"Header":{"StatusCode":"200 OK","ContentType":"status;plurality=single"},"Body":{"Status":{"Permissions":["Public","PhysicalAccess"]}}}

Signing request w/o button press (or too slow)
---

'{"Header":{"StatusCode":"401 Unauthorized","ClientTag":"get-cert","ContentType":"exception;plurality=single"},"Body":{"Exception":{"Message":"You are not authorized to perform this request"}}}

Successful signing request
---

'{"Header":{"StatusCode":"200 OK","ClientTag":"get-cert","ContentType":"signing-result;plurality=single"},"Body":{"SigningResult":{"Certificate":"-----BEGIN CERTIFICATE-----\\nMIIC5zCCAo2gAwIBAgIBATAKBggqhkjOPQQDAjCBgzELMAkGA1UEBhMCVVMxFTAT\\nBgNVBAgTDFBlbm5zeWx2YW5pYTEUMBIGA1UEBxMLQ29vcGVyc2J1cmcxJTAjBgNV\\nBAoTHEx1dHJvbiBFbGVjdHJvbmljcyBDby4sIEluYy4xIDAeBgNVBAMTF1NtYXJ0\\nQnJpZGdlOTA3MDY1RTM4RjI1MB4XDTE1MTAzMTAwMDAwMFoXDTM1MTAyNjAwMDAw\\nMFowajEmMCQGA1UEAxMdaG9tZWJyaWRnZS1sdXRyb24tY2FzZXRhLWxlYXAxHDAa\\nBgorBgEEAYK5CQECEwwwMDAwMDAwMDAwMDAxIjAgBgorBgEEAYK5CQEDDBJnZXRf\\nbHV0cm9uX2NlcnQucHkwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDl\\ngZgqYJVnMlEYaaMUdYYWcZA29MrlvPreeiZmQ2ecVAzh/RLkyCW4cB+eLfkkHe3Y\\n1BKgAw8UA8mPrXCN1EnNoXYpAATvbVus3R/WXnfi/15OJMKdedzpyWadgNb14dAe\\nwMGT8GfNrjhPgTs1BEnAnDMaDitrfe8szCD/XAPAywB302QhOXw3sazjjUKysLXU\\nYRcGHV8oB178pAJdy8PU9PqI1ndZgfRFK1XEqG/werAxWteJO6YtNpw8KyDPjKfL\\nij1hy/Nh4ZdzjiXqLSYPZhSrVHY7dL/f8LHDAEEf4pdKgxySeqEruyCXKGeJ10rQ\\nCmHYlVYfHqneQfatR3CdAgMBAAGjPzA9MA4GA1UdDwEB/wQEAwIFoDAdBgNVHSUE\\nFjAUBggrBgEFBQcDAQYIKwYBBQUHAwIwDAYDVR0TAQH/BAIwADAKBggqhkjOPQQD\\nAgNIADBFAiEA6P/FxTGhr8sQH3zs8iX+J6WLlQAYccbbHqTKKotF0JECIBBg4OQg\\nHNJg9xzp8yIjl8vipLt2+sviVjZHGDgL7YOC\\n-----END CERTIFICATE-----\\n","RootCertificate":"-----BEGIN CERTIFICATE-----\\nMIICGTCCAcCgAwIBAgIBATAKBggqhkjOPQQDAjCBgzELMAkGA1UEBhMCVVMxFTAT\\nBgNVBAgTDFBlbm5zeWx2YW5pYTEUMBIGA1UEBxMLQ29vcGVyc2J1cmcxJTAjBgNV\\nBAoTHEx1dHJvbiBFbGVjdHJvbmljcyBDby4sIEluYy4xIDAeBgNVBAMTF1NtYXJ0\\nQnJpZGdlOTA3MDY1RTM4RjI1MB4XDTE1MTAzMTAwMDAwMFoXDTM1MTAyNjAwMDAw\\nMFowgYMxCzAJBgNVBAYTAlVTMRUwEwYDVQQIEwxQZW5uc3lsdmFuaWExFDASBgNV\\nBAcTC0Nvb3BlcnNidXJnMSUwIwYDVQQKExxMdXRyb24gRWxlY3Ryb25pY3MgQ28u\\nLCBJbmMuMSAwHgYDVQQDExdTbWFydEJyaWRnZTkwNzA2NUUzOEYyNTBZMBMGByqG\\nSM49AgEGCCqGSM49AwEHA0IABHwaUv8PjzUhWjEg6MYhofN8wGNC6s+cwLSC9bBR\\nEvpAAoKqSLXKBDFTCmwdGJj6t2ibBs3dCdR2igKCtrwxrbajIzAhMA4GA1UdDwEB\\n/wQEAwIBvjAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0cAMEQCIE1OpNEA\\nmCJBhs5cF53+ETZyP53B3jnxBnx8p1CtlulPAiAc2LMpdtL/H/SWbCC7/iykNn5L\\nflnROpNa+aEHRIW/PQ==\\n-----END CERTIFICATE-----\\n"}}}'

*/
