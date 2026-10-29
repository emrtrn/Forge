import { expect, test } from "./test";

test("Shared foam material: Lake/River detail, lighting, quality leases and final disposal",async({page},info)=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
  await page.goto("/tests/smoke/pages/water-contact-foam.html");
  await page.waitForFunction(()=>!!(window as any).__contactQA);
  await page.waitForFunction(()=>{
    const qa=(window as any).__contactQA;qa.frame();qa.lakeFrame();
    const state=qa.materialState();return state.lakeReady===1&&state.riverReady===1;
  });
  const initial=await page.evaluate(()=>(window as any).__contactQA.materialState());
  expect(initial.shared).toBe(true);expect(initial.width).toBe(512);expect(initial.height).toBe(512);
  const view=(kind:"lake"|"river",time=3,light="day",far=false,reverse=false,foam=true)=>page.evaluate(
    ([kind,time,light,far,reverse,foam])=>(window as any).__contactQA.materialView(kind,time,light,far,reverse,foam),
    [kind,time,light,far,reverse,foam] as const);
  for(const kind of ["lake","river"] as const) {
    const day=await view(kind);expect(day.error).toBe(0);
    await page.screenshot({path:info.outputPath(`${kind}-foam-close.png`)});
    const moved=await view(kind,4);expect(moved.error).toBe(0);expect(moved.calls).toBe(day.calls);
    expect(day.samples.reduce((n:number,v:number,i:number)=>n+Math.abs(v-moved.samples[i]),0)).toBeGreaterThan(1000);
    const shadow=await view(kind,3,"shadow");expect(shadow.error).toBe(0);
    await page.screenshot({path:info.outputPath(`${kind}-foam-shadow.png`)});
    const night=await view(kind,3,"night");expect(night.error).toBe(0);
    const nightOff=await view(kind,3,"night",false,false,false);
    // Allow two output-code values for alpha/MSAA rounding; foam adds no night light.
    expect(night.samples.reduce((n:number,v:number,i:number)=>Math.max(n,v-nightOff.samples[i]),0)).toBeLessThanOrEqual(2);
    await view(kind,3,"night");
    await page.screenshot({path:info.outputPath(`${kind}-foam-night.png`)});
    await view(kind,3,"day",true,true);
    await page.screenshot({path:info.outputPath(`${kind}-foam-far-reverse.png`)});
  }
  const cycles=await page.evaluate(()=>(window as any).__contactQA.materialCycles(20));
  expect(cycles.isolated).toBe(true);expect(cycles.textures).toBe(initial.textures);expect(cycles.geometries).toBe(initial.geometries);
  const disposed=await page.evaluate(()=>(window as any).__contactQA.disposeMaterialScene());
  // Three retains one internal empty sampler2DArray; all four owned water textures leave.
  expect(disposed.textures).toBe(1);expect(disposed.disposed).toBe(disposed.owned);expect(errors).toEqual([]);
});

test("Foam material: a late image cannot revive a disposed scene",async({page})=>{
  const shaderErrors:string[]=[];page.on("pageerror",e=>shaderErrors.push(e.message));
  page.on("console",m=>{if(m.type()==="error"&&/shader|WebGLProgram/i.test(m.text()))shaderErrors.push(m.text());});
  let finishRequest:()=>void=()=>{};
  const gate=new Promise<void>(resolve=>{finishRequest=resolve;});
  await page.route("**/water-foam.png",async route=>{await gate;await route.continue();});
  await page.goto("/tests/smoke/pages/water-contact-foam.html",{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>!!(window as any).__contactQA);
  const pending=await page.evaluate(()=>{
    const qa=(window as any).__contactQA;const frame=qa.lakeFrame();return {frame,state:qa.materialState()};
  });
  expect(pending.frame.error).toBe(0);expect(pending.state.lakeReady).toBe(0);
  const response=page.waitForResponse(r=>r.url().includes("water-foam.png"));
  const before=await page.evaluate(()=>(window as any).__contactQA.disposeMaterialScene());
  finishRequest();await response;
  expect(before.textures).toBe(1);expect(before.disposed).toBe(before.owned);
  expect((await page.evaluate(()=>(window as any).__contactQA.materialState())).lakeReady).toBe(0);
  expect(shaderErrors).toEqual([]);
});

test("Foam material: missing texture retains the procedural fallback",async({page})=>{
  await page.route("**/water-foam.png",route=>route.fulfill({status:404,body:"missing"}));
  await page.goto("/tests/smoke/pages/water-contact-foam.html",{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>!!(window as any).__contactQA);
  const result=await page.evaluate(()=>{
    const qa=(window as any).__contactQA;const frame=qa.lakeFrame(true,3),river=qa.frame(true,3);
    return {frame,river,state:qa.materialState()};
  });
  expect(result.state.lakeReady).toBe(0);expect(result.state.riverReady).toBe(0);
  expect(result.frame.error).toBe(0);expect(result.river.error).toBe(0);
  expect(result.frame.samples.some((v:number)=>v>0)).toBe(true);
});

test("Lake baked geometry foam follows actual rock meshes and animates without extra draws",async({page},info)=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
  await page.goto("/tests/smoke/pages/water-contact-foam.html");await page.waitForFunction(()=>!!(window as any).__contactQA);
  const result=await page.evaluate(()=>(window as any).__contactQA.geometryBake());
  expect(result.nonempty).toBe(true);expect(result.metadata.sources).toBe(2);
  const frame=(enabled:boolean,t=0,reverse=false)=>page.evaluate(([enabled,t,reverse])=>(window as any).__contactQA.lakeFrame(enabled,t,reverse),[enabled,t,reverse] as [boolean,number,boolean]);
  const off=await frame(false),on=await frame(true),moved=await frame(true,3);
  const diff=(a:number[],b:number[])=>a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]!),0);
  expect(on.error).toBe(0);expect(on.calls).toBe(off.calls);expect(diff(off.samples,on.samples)).toBeGreaterThan(1000);expect(diff(on.samples,moved.samples)).toBeGreaterThan(1000);
  await page.screenshot({path:info.outputPath("baked-rock-contacts.png")});await frame(true,3,true);await page.screenshot({path:info.outputPath("baked-rock-contacts-reverse.png")});
  expect(errors).toEqual([]);
});

test("River real shore and obstacle wakes render, animate downstream and share the existing draw",async({page},info)=>{
  const errors:string[]=[];
  page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
  await page.goto("/tests/smoke/pages/water-contact-foam.html");
  await page.waitForFunction(()=>!!(window as any).__contactQA);
  const frame=(enabled:boolean,time=0,reverse=false)=>page.evaluate(([enabled,time,reverse])=>(window as any).__contactQA.frame(enabled,time,reverse),[enabled,time,reverse] as [boolean,number,boolean]);
  const off=await frame(false),on=await frame(true),moved=await frame(true,3);
  const difference=(a:number[],b:number[])=>a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]!),0);
  expect(on.error).toBe(0);expect(on.shore).toBe(true);expect(on.contacts).toBe(0);expect(on.baked).toBe(true);expect(on.flow).toEqual([0,1]);
  expect(difference(off.samples,on.samples)).toBeGreaterThan(1000);
  expect(difference(on.samples,moved.samples)).toBeGreaterThan(1000);
  expect(on.calls).toBe(off.calls);
  await page.screenshot({path:info.outputPath("river-contacts-downstream.png")});
  await frame(true,3,true);await page.screenshot({path:info.outputPath("river-contacts-upstream.png")});
  const lakeFrame=(enabled:boolean,time=0,reverse=false)=>page.evaluate(([enabled,time,reverse])=>(window as any).__contactQA.lakeFrame(enabled,time,reverse),[enabled,time,reverse] as [boolean,number,boolean]);
  const lakeOff=await lakeFrame(false),lakeOn=await lakeFrame(true),lakeMoved=await lakeFrame(true,3);
  expect(lakeOn.error).toBe(0);expect(lakeOn.calls).toBe(lakeOff.calls);
  expect(difference(lakeOff.samples,lakeOn.samples)).toBeGreaterThan(1000);
  expect(difference(lakeOn.samples,lakeMoved.samples)).toBeGreaterThan(1000);
  await page.screenshot({path:info.outputPath("lake-stone-contacts.png")});
  await lakeFrame(true,3,true);await page.screenshot({path:info.outputPath("lake-stone-contacts-reverse.png")});
  expect(errors).toEqual([]);
});
