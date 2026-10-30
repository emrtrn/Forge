import type { SceneApp, RiverWaterDetailsView } from "@/scene/SceneApp";
import { defaultLakeGeometryFoam } from "@engine/scene/lakeFoamBake";
import { defaultWaterCaustics, type WaterCaustics } from "@engine/scene/waterCaustics";
import { defaultWaterContactFoam } from "@engine/scene/waterContactFoam";
import { renderGeometryFoamDetails } from "./lakeGeometryFoamDetails";
import { defaultWaterShoreWetness } from "@engine/scene/waterShoreWetness";

export function renderRiverEffectsDetails(parent:HTMLElement,app:SceneApp,water:RiverWaterDetailsView,locked:boolean):void {
  const edit=(patch:Parameters<SceneApp["setSelectedLandscapeRiverWater"]>[1])=>app.setSelectedLandscapeRiverWater(water.id,patch);
  const crest=document.createElement("div"); crest.className="detail-section"; crest.dataset.detailSection="river-crest-foam";
  crest.innerHTML=`<div class="detail-section-title" title="Dalganın yükselen tepelerinde akışla taşınan parçalı köpük oluşturur.">Wave Crest Foam</div>
    <label class="detail-toggle"><input type="checkbox" aria-label="River Crest Foam Enabled" ${water.crestFoamEnabled?"checked":""} ${locked?"disabled":""}> Enabled</label>`;
  crest.querySelector<HTMLInputElement>("input")!.addEventListener("change",e=>edit({crestFoamEnabled:(e.target as HTMLInputElement).checked}));
  for(const [key,label,title] of [["crestFoamStrength","Strength","Dalga tepesi köpüğünün yoğunluğu; 0 köpüğü kapatır."],["crestFoamThreshold","Threshold","Köpük için gereken göreli dalga yüksekliği. Büyük değer yalnız en yüksek tepelerde köpük bırakır."]] as const) {
    const row=document.createElement("label");row.className="detail-row";row.textContent=label;row.title=title;
    const input=document.createElement("input");input.type="number";input.min="0";input.max="1";input.step=".05";input.value=String(water[key]);input.disabled=locked;input.dataset.riverCrestNumber=key;
    input.addEventListener("change",()=>{if(input.checkValidity()&&Number.isFinite(input.valueAsNumber))edit({[key]:input.valueAsNumber});});row.append(input);crest.append(row);
  }
  parent.append(crest);
  const wet=water.shoreWetness??defaultWaterShoreWetness(),wetSection=document.createElement("div");
  wetSection.className="detail-section";wetSection.dataset.detailSection="river-wet-shore";
  wetSection.innerHTML=`<div class="detail-section-title" title="Nehir tabanını ve kıyıdaki dar bandı yerel su yüksekliğine göre koyulaştırır ve parlaklaştırır.">Wet Shore</div>
    <label class="detail-toggle"><input type="checkbox" aria-label="River Wet Shore Enabled" data-river-wet-shore ${wet.enabled?"checked":""} ${locked?"disabled":""}> Enabled</label>`;
  wetSection.querySelector<HTMLInputElement>("input")!.addEventListener("change",e=>edit({shoreWetness:{...wet,enabled:(e.target as HTMLInputElement).checked}}));
  for(const [key,label,min,max,step,title] of [["width","Wet Band Width (m)",.2,4,.1,"Kuru kıyıdaki ıslak bandın metre cinsinden genişliği."],["strength","Wet Band Strength",0,1,.05,"Taban ve kıyı ıslaklığının görsel şiddeti; terrain boyamasını değiştirmez."]] as const) {
    const row=document.createElement("label");row.className="detail-row";row.textContent=label;row.title=title;
    const input=document.createElement("input");input.type="number";input.min=String(min);input.max=String(max);input.step=String(step);input.value=String(wet[key]);input.disabled=locked;input.dataset.riverWetShoreNumber=key;
    input.addEventListener("change",()=>{if(input.checkValidity()&&Number.isFinite(input.valueAsNumber))edit({shoreWetness:{...wet,[key]:input.valueAsNumber}});});row.append(input);wetSection.append(row);
  }
  parent.append(wetSection);
  renderGeometryFoamDetails(parent,water.geometryFoam??defaultLakeGeometryFoam(),app.getRiverGeometryFoamState(water.id),locked,false,{
    calculate:()=>void app.calculateRiverGeometryFoam(water.id),cancel:()=>app.cancelRiverGeometryFoam(),
    clear:()=>app.clearRiverGeometryFoam(water.id),edit:geometryFoam=>edit({geometryFoam}),
  });
  const section=document.createElement("div"),caustics=water.caustics??defaultWaterCaustics();
  section.className="detail-section";section.dataset.detailSection="river-caustics";
  section.innerHTML='<div class="detail-section-title" title="Nehir tabanındaki hareketli ışık desenini yerel su yüksekliği ve akış yönüne göre üretir.">Caustics</div>';
  const toggle=document.createElement("label");toggle.className="detail-toggle";
  const enabled=document.createElement("input");enabled.type="checkbox";enabled.checked=caustics.enabled;enabled.disabled=locked;enabled.setAttribute("aria-label","River Caustics Enabled");
  enabled.addEventListener("change",()=>edit({caustics:{...caustics,enabled:enabled.checked}}));toggle.append(enabled," Enabled");section.append(toggle);
  for(const [key,label,min,max,title] of [["strength","Strength",0,4,"Dip ışığının şiddeti."],["scale","Pattern Size (m)",.1,20,"Işık deseninin metre cinsinden boyutu."],["speed","Animation Speed",0,3,"Işık deseninin değişim hızı; nehir akışı ayrıca uygulanır."],["depthFade","Depth Fade (m)",.1,30,"Derinlik arttıkça ışığın sönme mesafesi."]] as const) {
    const row=document.createElement("label");row.className="detail-row";row.textContent=label;row.title=title;
    const input=document.createElement("input");input.type="number";input.min=String(min);input.max=String(max);input.step="any";input.value=String(caustics[key]);input.disabled=locked;input.dataset.riverCaustic=key;
    input.addEventListener("change",()=>{if(input.checkValidity()&&Number.isFinite(input.valueAsNumber))edit({caustics:{...caustics,[key]:input.valueAsNumber} as WaterCaustics});});row.append(input);section.append(row);
  }
  parent.append(section);
  const shore=water.contactFoam??defaultWaterContactFoam(),shoreSection=document.createElement("div");
  shoreSection.className="detail-section";shoreSection.dataset.detailSection="river-real-shore";
  shoreSection.innerHTML='<div class="detail-section-title">Shore Foam</div>';
  const shoreToggle=document.createElement("label");shoreToggle.className="detail-toggle";
  const shoreEnabled=document.createElement("input");shoreEnabled.type="checkbox";shoreEnabled.checked=shore.enabled;shoreEnabled.disabled=locked;shoreEnabled.setAttribute("aria-label","River Shore Foam Enabled");
  shoreEnabled.addEventListener("change",()=>edit({contactFoam:{...shore,enabled:shoreEnabled.checked}}));shoreToggle.append(shoreEnabled," Enabled");shoreSection.append(shoreToggle);
  for(const [key,label,min,max] of [["shoreWidth","Width (m)",.2,4],["scale","Pattern Size (m)",.1,10],["speed","Animation Speed",0,3]] as const) {
    const row=document.createElement("label");row.className="detail-row";row.textContent=label;
    const input=document.createElement("input");input.type="number";input.min=String(min);input.max=String(max);input.step="any";input.value=String(shore[key]);input.disabled=locked;
    input.addEventListener("change",()=>{if(input.checkValidity()&&Number.isFinite(input.valueAsNumber))edit({contactFoam:{...shore,[key]:input.valueAsNumber}});});row.append(input);shoreSection.append(row);
  }
  parent.append(shoreSection);
}
