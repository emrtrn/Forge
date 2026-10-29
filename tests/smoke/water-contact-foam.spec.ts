import { expect, test } from "./test";

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
