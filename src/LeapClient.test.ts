import * as debug from 'debug';

import * as MockTLS from "../__mocks__/tls";
import * as tls from 'tls';

import { ImportMock } from 'ts-mock-imports';

import { Response } from './Messages';
import { LeapClient } from './LeapClient';

const conn_stub = ImportMock.mockFunction(tls, 'connect', MockTLS.theSocket);
const ctx_stub = ImportMock.mockFunction(tls, 'createSecureContext', Object.create(null));

const log_debug = debug('leap:test:client');

it('round-trip in-flight', async () => {

    let request = '{"CommuniqueType":"ReadRequest","Header":{"ClientTag":"d2018137-c87f-4315-ab04-e727c4fc973b","Url":"/device"}}';
    let req_commtype = "ReadRequest";
    let req_url = "/device";
    let req_tag = "d2018137-c87f-4315-ab04-e727c4fc973b";

    let response = `{"CommuniqueType": "ReadResponse", "Header": {"ClientTag": "d2018137-c87f-4315-ab04-e727c4fc973b", "MessageBodyType": "MultipleDeviceDefinition", "StatusCode": "200 OK", "Url": "/device"}, "Body": {"First": 1, "Second": 2}}
`;

    let count = 0;
    let client = new LeapClient("foohost", 6666, "cafilestr", "keystr", "certstr");

    client.connect();

    MockTLS.__secureConnect();

    let p: Promise<Response> = client.request(req_commtype, req_url, undefined, req_tag);

    MockTLS.__tickle(response);

    let r = await(p)
        .then((resp: Response): any => {
            log_debug('test request has gotten a response');
            // @ts-ignore
            expect(MockTLS.__tellme()[0]).toEqual(request);
            count += 1;
            return resp;
        }).catch((err: Error) => {
            log_debug("what the shit", err)
        });

    expect(count).toEqual(1);
    expect(r.Header.StatusCode.code).toEqual(200);
    expect(r.Header.ClientTag).toEqual('d2018137-c87f-4315-ab04-e727c4fc973b');
});
