import {
  parseCropInstanceId,
  parseFarmId,
  parsePlayerId,
  parseTreeInstanceId
} from "@happy-farm/domain";

export const PLAYER_ONE_ID = parsePlayerId("player_11111111-1111-4111-8111-111111111111");
export const PLAYER_TWO_ID = parsePlayerId("player_22222222-2222-4222-8222-222222222222");
export const FARM_ONE_ID = parseFarmId("farm_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
export const FARM_TWO_ID = parseFarmId("farm_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
export const CROP_ONE_ID = parseCropInstanceId("cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc");
export const CROP_TWO_ID = parseCropInstanceId("cropinst_dddddddd-dddd-4ddd-8ddd-dddddddddddd");
export const TREE_ONE_ID = parseTreeInstanceId("treeinst_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
export const TREE_TWO_ID = parseTreeInstanceId("treeinst_ffffffff-ffff-4fff-8fff-ffffffffffff");
export const NOW = "2026-09-27T00:00:00.000Z";
