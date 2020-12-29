const debug = require('debug');

const MockTLS = require('../__mocks__/tls.js');
import * as tls from 'tls';

import { ImportMock } from 'ts-mock-imports';

import { Response } from './Messages';
import { LeapClient, ResponseWithTag } from './LeapClient';

const conn_stub = ImportMock.mockFunction(tls, 'connect', MockTLS.theSocket);
const ctx_stub = ImportMock.mockFunction(tls, 'createSecureContext', Object.create(null));

const logDebug = debug('leap:test:client');

beforeEach(() => {
    MockTLS.__reset();
});

// TODO: test socket close deletes things and removes listeners

it('subscribe and receive', async () => {
    logDebug('STARTING: subscribe and receive');

    const request =
        '{"CommuniqueType": "SubscribeRequest", "Header": {"ClientTag": "5433bbcc-fce6-40c8-bd97-6d1a17dfcd5b", "Url": "/occupancygroup/status"}}';
    const req_commtype = 'SubscribeRequest';
    const req_url = '/occupancygroup/status';
    const req_tag = '5433bbcc-fce6-40c8-bd97-6d1a17dfcd5b';

    const response = `{"CommuniqueType": "SubscribeResponse", "Header": {"ClientTag": "5433bbcc-fce6-40c8-bd97-6d1a17dfcd5b", "MessageBodyType": "OneZoneStatus", "StatusCode": "200 OK", "Url": "/occupancygroup/status"}, "Body": {}}
`;

    const count = 0;

    const client = new LeapClient('', 0, '', '', '');
    client.connect();
    MockTLS.__secureConnect();

    const mockSubHandle = jest.fn((response: Response): void => {
        logDebug('sub handler got called for tag ', response.Header.ClientTag);
        expect(response.Header.ClientTag).toEqual(req_tag);
    });

    const p: Promise<ResponseWithTag> = client.subscribe(req_url, mockSubHandle, req_commtype, undefined, req_tag);

    MockTLS.__tickle(response);

    const r: ResponseWithTag = await p;

    expect(r.response.Header.ClientTag).toEqual(req_tag);

    MockTLS.__tickle(response); // we can just re-use the response here; the tag is all that matters

    expect(mockSubHandle.mock.calls.length).toEqual(1);

    logDebug('DONE: subscribe and receive');
});

it('round-trip in-flight', async () => {
    logDebug('STARTING: round-trip in-flight');

    const request =
        `{"CommuniqueType":"ReadRequest","Header":{"ClientTag":"d2018137-c87f-4315-ab04-e727c4fc973b","Url":"/device"}}
`;
    const req_commtype = 'ReadRequest';
    const req_url = '/device';
    const req_tag = 'd2018137-c87f-4315-ab04-e727c4fc973b';

    const response = `{"CommuniqueType": "ReadResponse", "Header": {"ClientTag": "d2018137-c87f-4315-ab04-e727c4fc973b", "MessageBodyType": "MultipleDeviceDefinition", "StatusCode": "200 OK", "Url": "/device"}, "Body": {"First": 1, "Second": 2}}
`;

    const client = new LeapClient('foohost', 6666, 'cafilestr', 'keystr', 'certstr');

    client.connect();

    MockTLS.__secureConnect();

    const p: Promise<Response> = client.request(req_commtype, req_url, undefined, req_tag);

    MockTLS.__tickle(response);

    const r = await p;
    logDebug('test request has gotten a response');
    // @ts-ignore
    expect(MockTLS.__tellme()[0]).toEqual(request);

    expect(r.Header.StatusCode?.code).toEqual(200);
    expect(r.Header.ClientTag).toEqual('d2018137-c87f-4315-ab04-e727c4fc973b');

    logDebug('DONE: round-trip in-flight');
});

it('unsolicited event', async () => {
    logDebug('STARTING: unsolicited event');
    const response = `{"CommuniqueType": "ReadResponse", "Header": {"MessageBodyType": "MultipleDeviceDefinition", "StatusCode": "200 OK", "Url": "/device"}, "Body": {"First": 1, "Second": 2}}
`;

    const client = new LeapClient('', 100, '', '', '');

    client.connect();

    MockTLS.__secureConnect();

    const mockHandle = jest.fn((response: Response): void => {
        logDebug('unsolicited response handler got called for tag ', response.Header.ClientTag);
        expect(response.Header.ClientTag).toBeUndefined();
    });

    client.on('unsolicited', mockHandle);

    MockTLS.__tickle(response);

    expect(mockHandle.mock.calls.length).toEqual(1);

    logDebug('DONE: unsolicited event');
});
