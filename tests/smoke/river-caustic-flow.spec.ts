import {expect,test} from "@playwright/test";
import {writeFile} from "node:fs/promises";
import type {} from "./pages/river-caustic-flow";

test("River caustics regression: curved shared edges stay continuous after minutes and hours",async({page},info)=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
  await page.goto("/tests/smoke/pages/river-caustic-flow.html");await page.waitForFunction(()=>!!window.__riverCausticFlow);
  const measurements=[];
  for(const time of [60.37,3600.37]) {
    const before=await page.evaluate(t=>window.__riverCausticFlow.frame({time:t,faceFlow:true,unbounded:true}),time);
    const after=await page.evaluate(t=>window.__riverCausticFlow.frame({time:t,faceFlow:false,unbounded:false}),time);
    measurements.push({time,before,after});
    await writeFile(info.outputPath("caustic-edges.json"),JSON.stringify(measurements,null,2));
    expect(before.edges).toBeGreaterThan(20);expect(after.edges).toBeGreaterThan(20);
    expect(after.p95).toBeLessThan(before.p95*.5);expect(after.glError).toBe(0);expect(after.draws).toBe(before.draws);
  }
  await page.evaluate(()=>window.__riverCausticFlow.frame({time:60.37,faceFlow:false,unbounded:false,pattern:true}));
  await page.screenshot({path:info.outputPath("caustic-pattern.png")});expect(errors).toEqual([]);
});
