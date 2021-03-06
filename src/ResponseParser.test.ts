import { Response } from './Messages';
import { ResponseParser } from './ResponseParser';

test('single happy message', () => {
    const p = new ResponseParser();

    let proof = false;

    const line = `{"CommuniqueType": "SubscribeResponse", "Header": {"ClientTag": "something", "StatusCode": "204 NoContent", "Url": "/device/status/deviceheard"}}
`;

    function receive(response: Response) {
        expect(response.Header.ClientTag).toEqual('something');
        proof = true;
    }

    p.on('response', receive);
    p.handleData(line);

    expect(proof).toBeTruthy();
});

test('two lines', () => {
    const p = new ResponseParser();

    let count = 0;

    const line = `{"CommuniqueType": "SubscribeResponse", "Header": {"ClientTag": "first", "StatusCode": "204 NoContent", "Url": "/device/status/deviceheard"}}
{"CommuniqueType": "SubscribeResponse", "Header": {"ClientTag": "second", "StatusCode": "204 NoContent", "Url": "/device/status/deviceheard"}}
`;

    function receive(response: Response) {
        if (count == 0) {
            expect(response.Header.ClientTag).toEqual('first');
        } else {
            expect(response.Header.ClientTag).toEqual('second');
        }
        count += 1;
    }

    p.on('response', receive);
    p.handleData(line);

    expect(count).toEqual(2);
});

test('partial line', () => {
    const p = new ResponseParser();

    const line = '{"CommuniqueType": "SubscribeResponse", "Header": {';

    let proof = true;

    function receive(response: Response) {
        // should not get called
        proof = false;
    }

    p.on('response', receive);
    p.handleData(line);

    expect(proof).toBeTruthy();
});

test('full, then partial line', () => {
    const p = new ResponseParser();

    let count = 0;

    const line = `{"CommuniqueType": "SubscribeResponse", "Header": {"ClientTag": "first", "StatusCode": "204 NoContent", "Url": "/device/status/deviceheard"}}
{"CommuniqueType": "SubscribeResponse", "Header": `;

    function receive(response: Response) {
        expect(response.Header.ClientTag).toEqual('first');
        count += 1;
    }

    p.on('response', receive);
    p.handleData(line);

    expect(count).toEqual(1);
});

test('full line of garbage', () => {
    const p = new ResponseParser();

    const line = `this is not valid JSON, but it does end in a newline
`;

    let proof = true;

    function receive(response: Response) {
        proof = false;
    }

    p.on('response', receive);
    p.handleData(line);

    expect(proof).toBeTruthy();
});

test('throw away the garbage', () => {
    const p = new ResponseParser();

    const line = `this is not valid JSON, but it does end in a newline
{"CommuniqueType": "SubscribeResponse", "Header": {"ClientTag": "second", "StatusCode": "204 NoContent", "Url": "/device/status/deviceheard"}}
`;

    let count = 0;

    function receive(response: Response) {
        expect(response.Header.ClientTag).toEqual('second');
        count += 1;
    }

    p.on('response', receive);
    p.handleData(line);

    expect(count).toEqual(1);
});
