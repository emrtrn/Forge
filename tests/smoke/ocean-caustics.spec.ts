import { writeFile } from "node:fs/promises";
import { expect, test } from "./test";
import type {} from "./pages/ocean-caustics";

test.use({ viewport: { width: 680, height: 700 }, launchOptions: {
  ...(process.env.FORGE_CHROMIUM_EXECUTABLE ? { executablePath: process.env.FORGE_CHROMIUM_EXECUTABLE } : {}),
  args: ["--enable-unsafe-swiftshader"],
} });

test("ocean: native terrain caustics respect exact large coverage, dry basin, shadows, depth, FFT pause and quality", async ({page},info)=>{
  test.setTimeout(240_000);
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
  await page.goto("/tests/smoke/pages/ocean-caustics.html");
  await page.waitForFunction(()=>!!window.__oceanCaustics,{},{timeout:90_000});
  const result=await page.evaluate(()=>{
    const lab=window.__oceanCaustics;
    const off=lab.frame({enabled:false}),on=lab.frame({enabled:true}),paused=lab.frame();
    const roi=(a:number[],b:number[],x0=180,z0=180,width=40)=>{
      let total=0,count=0;for(let z=z0;z<z0+width;z++)for(let x=x0;x<x0+width;x++){
        const i=((255-z)*256+x)*4;for(let c=0;c<3;c++){total+=Math.abs(a[i+c]!-b[i+c]!);count++;}
      }return total/count;
    };
    const seamStart=lab.frame({clock:0}),seamEnd=lab.frame({clock:300}),seamNear=lab.frame({clock:299.999});
    const advanced=lab.frame({timeStep:.25}),held=lab.frame();
    const wrong=lab.frame({terrainRef:"other"});
    const deep=lab.frame({depth:12}),deepOff=lab.frame({enabled:false});
    const absorbed=lab.frame({enabled:true,depth:2,absorption:.5});
    const night=lab.frame({night:true}),nightOff=lab.frame({enabled:false,night:true});
    const cycles=[];
    for(let i=0;i<3;i++){
      const disabled=lab.frame({enabled:true,allowed:false}),active=lab.frame({allowed:true});
      cycles.push({disabled:disabled.resources,active:active.resources,textures:active.textures});
    }
    return {wet:roi(on.pixels,off.pixels),basin:roi(on.pixels,off.pixels,123,123,10),shadow:roi(on.pixels,off.pixels,60,60,8),
      wrap:roi(seamStart.pixels,seamEnd.pixels),wrapNear:roi(seamNear.pixels,seamStart.pixels),
      pause:roi(on.pixels,paused.pixels),animation:roi(advanced.pixels,held.pixels),moved:roi(on.pixels,advanced.pixels),
      wrong:roi(off.pixels,wrong.pixels),deep:roi(deep.pixels,deepOff.pixels),absorbed:roi(absorbed.pixels,off.pixels),
      night:roi(night.pixels,nightOff.pixels),cells:on.cells,draws:[off.draws,on.draws],samplers:[off.samplers,on.samplers],
      times:[on.time,paused.time,advanced.time,held.time],updates:[on.updates,paused.updates,advanced.updates,held.updates],
      finite:on.pixels.every(Number.isFinite),glError:on.glError,cycles};
  });
  await writeFile(info.outputPath("caustic-measurements.json"),JSON.stringify(result,null,2));
  await info.attach("caustic-measurements",{body:JSON.stringify(result,null,2),contentType:"application/json"});
  expect(result.cells).toBe(262144);expect(result.finite).toBe(true);expect(result.glError).toBe(0);
  expect(result.wet).toBeGreaterThan(.00001);expect(result.basin).toBeLessThan(.0000001);expect(result.shadow).toBeLessThan(result.wet*.01);
  expect(result.wrap).toBeLessThan(.00001);expect(result.wrapNear).toBeLessThan(.00001);
  expect(result.pause).toBe(0);expect(result.animation).toBe(0);expect(result.moved).toBeGreaterThan(.000001);
  expect(result.wrong).toBe(0);expect(result.deep).toBeLessThan(result.wet*.5);expect(result.absorbed).toBeLessThan(result.wet*.2);
  expect(result.night).toBe(0);expect(result.draws[1]).toBe(result.draws[0]);expect(result.samplers[1]).toBe(result.samplers[0]!+1);
  expect(result.times[1]).toBe(result.times[0]);expect(result.updates[1]).toBe(result.updates[0]);
  expect(result.times[2]).toBeGreaterThan(result.times[1]!);expect(result.times[3]).toBe(result.times[2]);expect(result.updates[3]).toBe(result.updates[2]);
  for(const cycle of result.cycles){expect(cycle.disabled.bodies).toBe(0);expect(cycle.disabled.patternBytes).toBe(0);expect(cycle.active.bodies).toBe(1);expect(cycle.active.atlasBytes).toBe(0);expect(cycle.textures).toBeLessThanOrEqual(result.cycles[0]!.textures);}
  await page.evaluate(()=>window.__oceanCaustics.frame({enabled:true,allowed:true,depth:2,absorption:9}));
  await page.screenshot({path:info.outputPath("ocean-native-caustics.png")});expect(errors).toEqual([]);
  await page.evaluate(()=>window.__oceanCaustics.dispose());
});
