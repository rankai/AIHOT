import {test} from "node:test";
import assert from "node:assert/strict";
import {redfoxInstagramHasVideo,redfoxDouyinHasVideo,redfoxXHasVideo,wechatMedia,agentKeyDouyinV4HasVideo} from "@aihot/backend/providers/redfox/video-media";

test("Douyin route-specific positive enums do not cross libraries or guess rank/default values",()=>{
  for(const op of ["QSL2ZSXM","OWIBYU1V","FK67XDVQ"])for(const videoType of ["0","63"])assert.equal(redfoxDouyinHasVideo(op,{videoType}),true);
  for(const op of ["QEQLCKD6","774OBKK0"])assert.equal(redfoxDouyinHasVideo(op,{workType:"视频"}),true);
  for(const [op,record] of [["FK67XDVQ",{videoType:68}],["FK67XDVQ",{videoType:0}],["0OT1E306",{workType:"default"}],["HUCIASU",{workType:"0",videoType:0}],["WD6UT8DQ",{videoType:0}],["QEQLCKD6",{workType:"图文"}],["I8P3HTVH",{workType:"视频"}]] as const)assert.equal(redfoxDouyinHasVideo(op,record),false);
});
test("Redfox X confirms only own documented video arrays and rejects explicit GIF or malformed collections",()=>{
  assert.equal(redfoxXHasVideo([{type:"video"}]),true);
  assert.equal(redfoxXHasVideo({videos:[{}]}),true);
  for(const medias of [null,[],{},[{type:"animated_gif"}],[{type:"video",isGif:true}],{videos:[]},{videos:"video"},{videos:[null]},{videos:[false]},{videos:["unknown"]},{videos:[{type:"animated_gif"}]},{videos:[{isGif:true}]},{photos:[{}]},{quoted:{medias:{videos:[{}]}}}])assert.equal(redfoxXHasVideo(medias),false);
});
test("Wechat reuses valid videoLink mapping and only the verified caller enables confirmation",()=>{
  const record={videoLink:"https://example.test/video.mp4",coverImageUrl:"https://example.test/cover.png",imageUrls:["javascript:bad"],picList:[null]};
  assert.equal(wechatMedia(record).find(m=>m.kind==="video")?.confirmed,undefined);
  assert.equal(wechatMedia(record,true).find(m=>m.kind==="video")?.confirmed,true);
  assert.deepEqual(wechatMedia({_content_type:"video"},true),[{kind:"video",confirmed:true}]);
  assert.deepEqual(wechatMedia({videoLink:"javascript:bad",videoPageInfoList:[{}]}),[]);
});
test("AgentKey V4 video fact requires exact successful raw Video identity without changing the saved projection",()=>{
  const wrap=(Video:unknown,AwemeId:unknown="123")=>({envelope:{provider:"TikHub",data:{code:200,data:{code:0,data:{itemList:[{AwemeInfo:{AwemeId,Video}}]}}}}});
  assert.equal(agentKeyDouyinV4HasVideo(wrap({ItemID:"123"}),"item:0","123"),true);
  for(const [response,key,id] of [[wrap(undefined),"item:0","123"],[wrap({ItemID:"124"}),"item:0","123"],[wrap({ItemID:"123"},"124"),"item:0","123"],[wrap({ItemID:"123"}),"item:01","123"],[wrap({ItemID:9007199254740992}),"item:0","9007199254740992"],[{},"item:0","123"]] as const)assert.equal(agentKeyDouyinV4HasVideo(response,key,id),false);
});

test("Instagram requires an uncontradicted top-level video type",()=>{
 for(const record of [{mediaType:2},{mediaType:2,mediaFormat:"video"}])assert.equal(redfoxInstagramHasVideo(record),true);
 for(const record of [{mediaType:2,mediaFormat:"photo"},{mediaType:2,mediaFormat:"image"},{mediaType:2,mediaFormat:"unknown"},{mediaType:2,isVideo:false},{mediaType:8,carouselItems:[{mediaType:2,isVideo:true}]},{mediaFormat:"video"}])assert.equal(redfoxInstagramHasVideo(record),false);
});
