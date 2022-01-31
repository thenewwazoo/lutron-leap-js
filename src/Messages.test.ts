import { Response, ResponseHeader, ResponseStatus } from './Messages';

test('newly-discovered device', () => {
    const line =
        '{"CommuniqueType": "UpdateResponse", "Header": {"MessageBodyType": "OneDeviceStatus", "StatusCode": "200 OK", "Url": "/device/status/deviceheard"}, "Body": {"DeviceStatus": {"DeviceHeard": {"DiscoveryMechanism": "UserInteraction", "ModelNumber": "PJ2-2BRL-GXX-X01", "DeviceType": "Pico2ButtonRaiseLower", "SerialNumber": 69709128}}}}';

    const response: Response = Response.fromJSON(JSON.parse(line));
    expect(response?.Header.StatusCode?.code).toEqual(200);
    expect(response?.CommuniqueType).toEqual('UpdateResponse');
    // @ts-ignore
    expect(response.Body.DeviceStatus.DeviceHeard.SerialNumber).toEqual(69709128);
});

test('full response decode', () => {
    const line =
        '{"CommuniqueType": "ReadResponse", "Header": {"ClientTag": "d2018137-c87f-4315-ab04-e727c4fc973b", "MessageBodyType": "OneZoneStatus", "StatusCode": "200 OK", "Url": "/zone/1/status"}, "Body": {"ZoneStatus": {"href": "/zone/1/status", "Level": 100, "Zone": {"href": "/zone/1"}, "StatusAccuracy": "Good"}}}';

    const response: Response = Response.fromJSON(JSON.parse(line));

    expect(response?.Header.StatusCode?.code).toEqual(200);
    expect(response?.Header.ClientTag).toEqual('d2018137-c87f-4315-ab04-e727c4fc973b');
    expect(response?.CommuniqueType).toEqual('ReadResponse');
    // @ts-ignore
    expect(response.Body.ZoneStatus.Level).toEqual(100);
});

test('no-tag, no-body response decode', () => {
    const line =
        '{"CommuniqueType": "SubscribeResponse", "Header": {"StatusCode": "204 NoContent", "Url": "/device/status/deviceheard"}}';

    const response: Response = Response.fromJSON(JSON.parse(line));

    expect(response?.Header.StatusCode?.code).toEqual(204);
    expect(response?.Header.ClientTag).toBeUndefined();
    expect(response?.CommuniqueType).toEqual('SubscribeResponse');
    expect(response?.Body).toBeUndefined();
});

test('status line decode', () => {
    const line = '204 NoContent';

    const status = ResponseStatus.fromString(line);

    expect(status.code).toEqual(204);
    expect(status.message).toEqual('NoContent');
    expect(status.isSuccessful()).toBeTruthy();
});

test('header decode', () => {
    const happy_header =
        '{"MessageBodyType": "MultipleDeviceDefinition", "StatusCode": "200 OK", "Url": "/device", "ClientTag": "d2018137-c87f-4315-ab04-e727c4fc973b"}';

    const resp_hdr: ResponseHeader = ResponseHeader.fromJSON(JSON.parse(happy_header));

    expect(resp_hdr?.StatusCode?.code).toEqual(200);
    expect(resp_hdr?.StatusCode?.message).toEqual('OK');
    expect(resp_hdr?.StatusCode?.isSuccessful()).toBeTruthy();

    expect(resp_hdr?.Url).toEqual('/device');
    expect(resp_hdr?.ClientTag).toEqual('d2018137-c87f-4315-ab04-e727c4fc973b');
    expect(resp_hdr?.MessageBodyType).toEqual('MultipleDeviceDefinition');
});

test('no content header decode', () => {
    const line = '{"StatusCode": "204 NoContent", "Url": "/device/status/deviceheard"}';

    const resp_hdr: ResponseHeader = ResponseHeader.fromJSON(JSON.parse(line));

    expect(resp_hdr?.StatusCode?.code).toEqual(204);
    expect(resp_hdr?.StatusCode?.message).toEqual('NoContent');
    expect(resp_hdr?.StatusCode?.isSuccessful()).toBeTruthy();

    expect(resp_hdr?.Url).toEqual('/device/status/deviceheard');
    expect(resp_hdr?.ClientTag).toBeUndefined();
    expect(resp_hdr?.MessageBodyType).toBeUndefined();
});

test('unsuccessful status code', () => {
    const line = '{"StatusCode": "500 InternalError"}';

    const resp_hdr: ResponseHeader = ResponseHeader.fromJSON(JSON.parse(line));

    expect(resp_hdr?.StatusCode?.code).toEqual(500);
    expect(resp_hdr?.StatusCode?.message).toEqual('InternalError');
    expect(resp_hdr?.StatusCode?.isSuccessful()).toBeFalsy();

    expect(resp_hdr?.Url).toBeUndefined();
    expect(resp_hdr?.ClientTag).toBeUndefined();
    expect(resp_hdr?.MessageBodyType).toBeUndefined();
});

test('no number code', () => {
    const line = '{"StatusCode": "InternalError"}';

    const resp_hdr: ResponseHeader = ResponseHeader.fromJSON(JSON.parse(line));

    expect(resp_hdr?.StatusCode?.code).toBeUndefined();
    expect(resp_hdr?.StatusCode?.message).toEqual('InternalError');
    expect(resp_hdr?.StatusCode?.isSuccessful()).toBeFalsy();

    expect(resp_hdr?.Url).toBeUndefined();
    expect(resp_hdr?.ClientTag).toBeUndefined();
    expect(resp_hdr?.MessageBodyType).toBeUndefined();
});

test('mangled status code', () => {
    const line = '{"StatusCode": "asdfkjlkjwe wafjehi"}';

    const resp_hdr: ResponseHeader = ResponseHeader.fromJSON(JSON.parse(line));

    expect(resp_hdr?.StatusCode?.code).toBeUndefined();
    expect(resp_hdr?.StatusCode?.message).toEqual('asdfkjlkjwe wafjehi');
    expect(resp_hdr?.StatusCode?.isSuccessful()).toBeFalsy();

    expect(resp_hdr?.Url).toBeUndefined();
    expect(resp_hdr?.ClientTag).toBeUndefined();
    expect(resp_hdr?.MessageBodyType).toBeUndefined();
});

test('mangled', () => {
    const line = '{"Invalid": "Yes I am"}';

    const resp = Response.fromJSON(JSON.parse(line));

    expect(resp.Body).toBeUndefined();
    expect(resp.CommuniqueType).toBeUndefined();
    expect(resp.Header.StatusCode).toBeUndefined();
});

test('OneAreaStatus', () => {
    const line =
        '{"CommuniqueType":"ReadResponse","Header":{"MessageBodyType":"OneAreaStatus","StatusCode":"200 OK","Url":"/area/729/status","ClientTag":"afbacb1f-32bd-47de-9a2a-191e60e5c2a9"},"Body":{"AreaStatus":{"href":"/area/729/status","Level":0,"OccupancyStatus":"Unoccupied","CurrentScene":{"href":"/areascene/733"}}}}';

    const response: Response = Response.fromJSON(JSON.parse(line));
    expect(response?.Header.StatusCode?.code).toEqual(200);
    expect(response?.CommuniqueType).toEqual('ReadResponse');
    // @ts-ignore
    expect(response.Body.AreaStatus.OccupancyStatus).toEqual('Unoccupied');
});

test('OneZoneDefinition', () => {
    const line =
        '{"CommuniqueType":"ReadResponse","Header":{"MessageBodyType":"OneZoneDefinition","StatusCode":"200 OK","Url":"/zone/622","ClientTag":"ec1ec311-1e53-439d-ac46-0908252d7d08"},"Body":{"Zone":{"href":"/zone/622","Name":"Loft Outdoors","ControlType":"Switched","Category":{"Type":"OtherAmbient","IsLight":true},"AssociatedArea":{"href":"/area/729"},"SortOrder":0}}}';

    const response: Response = Response.fromJSON(JSON.parse(line));
    expect(response?.Header.StatusCode?.code).toEqual(200);
    expect(response?.CommuniqueType).toEqual('ReadResponse');
    // @ts-ignore
    expect(response.Body.Zone.ControlType).toEqual('Switched');
});

test('OneAreaDefinition', () => {
    const line =
        '{"CommuniqueType":"ReadResponse","Header":{"MessageBodyType":"OneAreaDefinition","StatusCode":"200 OK","Url":"/area/729","ClientTag":"2ac306b1-13f3-4d11-a4d7-b5b4776311f3"},"Body":{"Area":{"href":"/area/729","Name":"Loft","Parent":{"href":"/area/24"},"AssociatedZones":[{"href":"/zone/622"}],"AssociatedControlStations":[{"href":"/controlstation/613"},{"href":"/controlstation/750"}]}}}';

    const response: Response = Response.fromJSON(JSON.parse(line));
    expect(response?.Header.StatusCode?.code).toEqual(200);
    expect(response?.CommuniqueType).toEqual('ReadResponse');
    // @ts-ignore
    expect(response.Body.Area.Name).toEqual('Loft');
});

test('OneControlStationDefinition', () => {
    const line =
        '{"CommuniqueType":"ReadResponse","Header":{"MessageBodyType":"OneControlStationDefinition","StatusCode":"200 OK","Url":"/controlstation/613","ClientTag":"0020d264-db53-47d7-b3fe-1b07017c3055"},"Body":{"ControlStation":{"href":"/controlstation/613","Name":"Loft Outdoor Lights","AssociatedArea":{"href":"/area/729"},"SortOrder":0,"AssociatedGangedDevices":[{"Device":{"href":"/device/615","DeviceType":"SunnataSwitch","AddressedState":"Addressed"},"GangPosition":0}]}}}';

    const response: Response = Response.fromJSON(JSON.parse(line));
    expect(response?.Header.StatusCode?.code).toEqual(200);
    expect(response?.CommuniqueType).toEqual('ReadResponse');
    // @ts-ignore
    expect(response.Body.ControlStation.Name).toEqual('Loft Outdoor Lights');
});

test('OneProjectDefinition', () => {
    const line =
        '{"CommuniqueType":"ReadResponse","Header":{"MessageBodyType":"OneProjectDefinition","StatusCode":"200 OK","Url":"/project","ClientTag":"8c5c9547-f246-4991-8150-6d84f76e9046"},"Body":{"Project":{"href":"/project","Name":"Home","ProductType":"Lutron RadioRA 3 Project","MasterDeviceList":{"Devices":[{"href":"/device/96"}]},"Contacts":[{"href":"/contactinfo/81"}],"TimeclockEventRules":{"href":"/project/timeclockeventrules"},"ProjectModifiedTimestamp":{"Year":2022,"Month":1,"Day":28,"Hour":19,"Minute":24,"Second":29,"Utc":"0"}}}}';

    const response: Response = Response.fromJSON(JSON.parse(line));
    expect(response?.Header.StatusCode?.code).toEqual(200);
    expect(response?.CommuniqueType).toEqual('ReadResponse');
    // @ts-ignore
    expect(response.Body.Project.Name).toEqual('Home');
});

test('OneLinkNodeDefinition', () => {
    const line =
        '{"CommuniqueType":"ReadResponse","Header":{"MessageBodyType":"OneLinkNodeDefinition","StatusCode":"200 OK","Url":"/device/615/linknode/617","ClientTag":"3a784f3d-660b-4eac-8dd8-b34127e1e1fe"},"Body":{"LinkNode":{"href":"/device/615/linknode/617","Parent":{"href":"/device/615"},"LinkType":"ClearConnectTypeX","RFProperties":{},"AssociatedLink":{"href":"/link/98"}}}}';

    const response: Response = Response.fromJSON(JSON.parse(line));
    expect(response?.Header.StatusCode?.code).toEqual(200);
    expect(response?.CommuniqueType).toEqual('ReadResponse');
    // @ts-ignore
    expect(response.Body.LinkNode.LinkType).toEqual('ClearConnectTypeX');
});

test('OneAreaSceneDefinition', () => {
    const line =
        '{"CommuniqueType":"ReadResponse","Header":{"MessageBodyType":"OneAreaSceneDefinition","StatusCode":"200 OK","Url":"/areascene/734","ClientTag":"5f7ed150-b163-4535-9cd1-0a641fa651a4"},"Body":{"AreaScene":{"href":"/areascene/734","Name":"Scene 001","Parent":{"href":"/area/729"},"Preset":{"href":"/preset/734"},"SortOrder":1}}}';

    const response: Response = Response.fromJSON(JSON.parse(line));
    expect(response?.Header.StatusCode?.code).toEqual(200);
    expect(response?.CommuniqueType).toEqual('ReadResponse');
    // @ts-ignore
    expect(response.Body.AreaScene.Name).toEqual('Scene 001');
});

test('OnePresetDefinition', () => {
    const line =
        '{"CommuniqueType":"ReadResponse","Header":{"MessageBodyType":"OnePresetDefinition","StatusCode":"200 OK","Url":"/preset/734","ClientTag":"1054a432-f650-4985-bdd2-f2e9ebaa7278"},"Body":{"Preset":{"href":"/preset/734","Parent":{"href":"/areascene/734"}}}}';

    const response: Response = Response.fromJSON(JSON.parse(line));
    expect(response?.Header.StatusCode?.code).toEqual(200);
    expect(response?.CommuniqueType).toEqual('ReadResponse');
    // @ts-ignore
    expect(response.Body.Preset.Parent).toEqual({"href":"/areascene/734"});
});
