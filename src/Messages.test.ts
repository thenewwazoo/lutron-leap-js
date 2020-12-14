import { Response, ResponseHeader, ResponseStatus } from './Messages';

test('full response decode', () => {
    let line = '{"CommuniqueType": "ReadResponse", "Header": {"ClientTag": "d2018137-c87f-4315-ab04-e727c4fc973b", "MessageBodyType": "OneZoneStatus", "StatusCode": "200 OK", "Url": "/zone/1/status"}, "Body": {"ZoneStatus": {"href": "/zone/1/status", "Level": 100, "Zone": {"href": "/zone/1"}, "StatusAccuracy": "Good"}}}';

    let response: Response = Response.fromJSON(JSON.parse(line));

    expect(response.Header.StatusCode.code).toEqual(200);
    expect(response.Header.ClientTag).toEqual("d2018137-c87f-4315-ab04-e727c4fc973b");
    expect(response.CommuniqueType).toEqual("ReadResponse");
    expect(response.Body.ZoneStatus.Level).toEqual(100);
});

test('no-tag, no-body response decode', () => {
    let line = '{"CommuniqueType": "SubscribeResponse", "Header": {"StatusCode": "204 NoContent", "Url": "/device/status/deviceheard"}}';

    let response: Response = Response.fromJSON(JSON.parse(line));

    expect(response.Header.StatusCode.code).toEqual(204);
    expect(response.Header.ClientTag).toBeUndefined();
    expect(response.CommuniqueType).toEqual("SubscribeResponse");
    expect(response.Body).toBeUndefined();
});

test('status line decode', () => {
    let line = "204 NoContent";

    let status = ResponseStatus.fromString(line);

    expect(status.code).toEqual(204);
    expect(status.message).toEqual("NoContent");
    expect(status.isSuccessful()).toBeTruthy();

});

test('header decode', () => {
    let happy_header = '{"MessageBodyType": "MultipleDeviceDefinition", "StatusCode": "200 OK", "Url": "/device", "ClientTag": "d2018137-c87f-4315-ab04-e727c4fc973b"}';

    let resp_hdr: ResponseHeader = ResponseHeader.fromJSON(JSON.parse(happy_header));

    expect(resp_hdr.StatusCode.code).toEqual(200);
    expect(resp_hdr.StatusCode.message).toEqual('OK');
    expect(resp_hdr.StatusCode.isSuccessful()).toBeTruthy();

    expect(resp_hdr.Url).toEqual('/device');
    expect(resp_hdr.ClientTag).toEqual('d2018137-c87f-4315-ab04-e727c4fc973b');
    expect(resp_hdr.MessageBodyType).toEqual('MultipleDeviceDefinition');

});

test('no content header decode', () => {
    let line = '{"StatusCode": "204 NoContent", "Url": "/device/status/deviceheard"}';

    let resp_hdr: ResponseHeader = ResponseHeader.fromJSON(JSON.parse(line));

    expect(resp_hdr.StatusCode.code).toEqual(204);
    expect(resp_hdr.StatusCode.message).toEqual('NoContent');
    expect(resp_hdr.StatusCode.isSuccessful()).toBeTruthy();

    expect(resp_hdr.Url).toEqual('/device/status/deviceheard');
    expect(resp_hdr.ClientTag).toBeUndefined();
    expect(resp_hdr.MessageBodyType).toBeUndefined();

});

test('unsuccessful status code', () => {
    let line = '{"StatusCode": "500 InternalError"}';

    let resp_hdr: ResponseHeader = ResponseHeader.fromJSON(JSON.parse(line));

    expect(resp_hdr.StatusCode.code).toEqual(500);
    expect(resp_hdr.StatusCode.message).toEqual("InternalError");
    expect(resp_hdr.StatusCode.isSuccessful()).toBeFalsy();

    expect(resp_hdr.Url).toBeUndefined();
    expect(resp_hdr.ClientTag).toBeUndefined();
    expect(resp_hdr.MessageBodyType).toBeUndefined();

});

test('no number code', () => {
    let line = '{"StatusCode": "InternalError"}';

    let resp_hdr: ResponseHeader = ResponseHeader.fromJSON(JSON.parse(line));

    expect(resp_hdr.StatusCode.code).toBeUndefined();
    expect(resp_hdr.StatusCode.message).toEqual("InternalError");
    expect(resp_hdr.StatusCode.isSuccessful()).toBeFalsy();

    expect(resp_hdr.Url).toBeUndefined();
    expect(resp_hdr.ClientTag).toBeUndefined();
    expect(resp_hdr.MessageBodyType).toBeUndefined();

});

test('mangled status code', () => {
    let line = '{"StatusCode": "asdfkjlkjwe wafjehi"}';

    let resp_hdr: ResponseHeader = ResponseHeader.fromJSON(JSON.parse(line));

    expect(resp_hdr.StatusCode.code).toBeUndefined();
    expect(resp_hdr.StatusCode.message).toEqual("asdfkjlkjwe wafjehi");
    expect(resp_hdr.StatusCode.isSuccessful()).toBeFalsy();

    expect(resp_hdr.Url).toBeUndefined();
    expect(resp_hdr.ClientTag).toBeUndefined();
    expect(resp_hdr.MessageBodyType).toBeUndefined();

});

test('mangled', () => {
    let line = '{"Invalid": "Yes I am"}';

    let resp = Response.fromJSON(JSON.parse(line));

    expect(resp.Body).toBeUndefined();
    expect(resp.CommuniqueType).toBeUndefined();
    expect(resp.Header.StatusCode).toBeUndefined();

});
