import * as debug from 'debug';

import * as MockTLS from "../__mocks__/tls";
import * as tls from 'tls';

import { ImportMock } from 'ts-mock-imports';

import { Response } from './Messages';
import { LeapClient, ResponseWithTag } from './LeapClient';

const conn_stub = ImportMock.mockFunction(tls, 'connect', MockTLS.theSocket);
const ctx_stub = ImportMock.mockFunction(tls, 'createSecureContext', Object.create(null));

const log_debug = debug('leap:test:client');

beforeEach(() => {
    MockTLS.__reset();
});

it('subscribe and receive', async () => {
    let request = '{"CommuniqueType": "SubscribeRequest", "Header": {"ClientTag": "5433bbcc-fce6-40c8-bd97-6d1a17dfcd5b", "Url": "/occupancygroup/status"}}';
    let req_commtype = "SubscribeRequest";
    let req_url = "/occupancygroup/status";
    let req_tag = "5433bbcc-fce6-40c8-bd97-6d1a17dfcd5b";

    let response = `{"CommuniqueType": "SubscribeResponse", "Header": {"ClientTag": "5433bbcc-fce6-40c8-bd97-6d1a17dfcd5b", "MessageBodyType": "MultipleOccupancyGroupStatus", "StatusCode": "200 OK", "Url": "/occupancygroup/status"}, "Body": {}}
`;

    let count = 0;

    let client = new LeapClient("", 0, "", "", "");
    client.connect();
    MockTLS.__secureConnect();

    const mockSubHandle = jest.fn((response: Response): void => {
        log_debug("sub handler got called for tag ", response.Header.ClientTag);
        expect(response.Header.ClientTag).toEqual(req_tag);
    });

    let p: Promise<ResponseWithTag> = client.subscribe(req_url, mockSubHandle, req_commtype, undefined, req_tag);

    MockTLS.__tickle(response);

    let r: ResponseWithTag = await(p);

    expect(r.response.Header.ClientTag).toEqual(req_tag);

    MockTLS.__tickle(response); // we can just re-use the response here; the tag is all that matters

    expect(mockSubHandle.mock.calls.length).toEqual(1);

});

it('round-trip in-flight', async () => {

    let request = '{"CommuniqueType":"ReadRequest","Header":{"ClientTag":"d2018137-c87f-4315-ab04-e727c4fc973b","Url":"/device"}}';
    let req_commtype = "ReadRequest";
    let req_url = "/device";
    let req_tag = "d2018137-c87f-4315-ab04-e727c4fc973b";

    let response = `{"CommuniqueType": "ReadResponse", "Header": {"ClientTag": "d2018137-c87f-4315-ab04-e727c4fc973b", "MessageBodyType": "MultipleDeviceDefinition", "StatusCode": "200 OK", "Url": "/device"}, "Body": {"First": 1, "Second": 2}}
`;

    let client = new LeapClient("foohost", 6666, "cafilestr", "keystr", "certstr");

    client.connect();

    MockTLS.__secureConnect();

    let p: Promise<Response> = client.request(req_commtype, req_url, undefined, req_tag);

    MockTLS.__tickle(response);

    let r = await(p);
    log_debug('test request has gotten a response');
    // @ts-ignore
    expect(MockTLS.__tellme()[0]).toEqual(request);

    expect(r.Header.StatusCode.code).toEqual(200);
    expect(r.Header.ClientTag).toEqual('d2018137-c87f-4315-ab04-e727c4fc973b');
});
