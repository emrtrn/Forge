import type { SceneApp } from "@/scene/SceneApp";
import type { LayoutLakeWaterBody } from "@engine/scene/layout";
import { defaultLakeGeometryFoam, type LakeGeometryFoam } from "@engine/scene/lakeFoamBake";

export function renderGeometryFoamDetails(parent:HTMLElement,settings:LakeGeometryFoam,state:{busy:boolean;message:string;stale?:boolean},locked:boolean,draft:boolean,
  actions:{calculate:()=>void;cancel:()=>void;clear:()=>void;edit:(settings:LakeGeometryFoam)=>void}):void {
  const disabled=locked||draft?"disabled":"",section=document.createElement("div");
  section.className="detail-section";section.dataset.detailSection="lake-geometry-foam";
  const field=(label:string,key:keyof Pick<LakeGeometryFoam,"width"|"strength"|"scale"|"speed">,min:number,max:number)=>
    `<label class="detail-row"><span>${label}</span><input aria-label="${label}" title="${({width:"Temas bandının metre cinsinden genişliği. Değiştirdikten sonra yeniden hesaplayın.",strength:"Hesaplanan taş temas köpüğünün görünürlüğü.",scale:"Parçalı köpük deseninin metre cinsinden boyutu.",speed:"Köpük deseninin hareket hızı; geometriyi yeniden hesaplamaz."})[key]}" data-geometry-foam-number="${key}" type="number" min="${min}" max="${max}" step="any" value="${settings[key]}" ${disabled}></label>`;
  section.innerHTML=`<div class="detail-section-title" title="Taşların gerçek su temaslarından köpük üretir. Taşları yerleştirdikten sonra hesaplayın; taş değişiklikleri otomatik hesaplama başlatmaz.">Obstacle Foam</div>
    ${draft?'<div class="detail-hint" title="Önce gölü oluşturun.">Create the Lake first.</div>':""}
    <label class="detail-toggle" title="Hesaplanan taş ve engel köpüğünü gösterir veya gizler."><input data-geometry-foam-enabled type="checkbox" aria-label="Geometry Foam Enabled" ${settings.enabled?"checked":""} ${disabled}> Enabled</label>
    ${field("Contact Width (m)","width",.1,4)}${field("Foam Strength","strength",0,1)}${field("Pattern Size (m)","scale",.1,10)}${field("Animation Speed","speed",0,3)}
    <button type="button" class="detail-action-button" title="Göl çevresindeki uygun taşların gerçek su kesişimlerini topluca hesaplar. Taşları değiştirdikten sonra tekrar kullanın." data-geometry-foam-calculate ${disabled||state.busy?"disabled":""}>${settings.bake?"Recalculate":"Calculate"}</button>
    ${state.busy?'<button type="button" class="detail-action-button" title="İşlemi iptal eder; önceki başarılı köpük korunur." data-geometry-foam-cancel>Cancel</button>':""}
    <button type="button" class="detail-action-button" title="Hesaplanan köpüğü temizler. Undo ile geri alınabilir." data-geometry-foam-clear ${disabled||!settings.bake||state.busy?"disabled":""}>Clear</button>
    <div role="status" class="detail-hint" title="Taşlar, göl seviyesi veya temas genişliği değiştiyse yeniden hesaplayın. Kaydedilen sonuç Reload ve Play sırasında tekrar hesaplanmaz." data-geometry-foam-status></div>`;
  section.querySelector("[data-geometry-foam-status]")!.textContent=(state.stale&&!state.message.includes("Recalculation required")?"Recalculation required. ":"")+state.message;
  section.querySelector("[data-geometry-foam-calculate]")!.addEventListener("click",actions.calculate);
  section.querySelector("[data-geometry-foam-cancel]")?.addEventListener("click",actions.cancel);
  section.querySelector("[data-geometry-foam-clear]")!.addEventListener("click",actions.clear);
  section.querySelector<HTMLInputElement>("[data-geometry-foam-enabled]")!.addEventListener("change",e=>actions.edit({...settings,enabled:(e.target as HTMLInputElement).checked}));
  section.querySelectorAll<HTMLInputElement>("[data-geometry-foam-number]").forEach(input=>input.addEventListener("change",()=>{
    if(input.checkValidity()&&Number.isFinite(input.valueAsNumber))actions.edit({...settings,[input.dataset.geometryFoamNumber!]:input.valueAsNumber});
  }));parent.append(section);
}

export function renderLakeGeometryFoamDetails(parent:HTMLElement,app:SceneApp,lake:LayoutLakeWaterBody,draft:boolean):void {
  renderGeometryFoamDetails(parent,lake.geometryFoam??defaultLakeGeometryFoam(),app.getLakeGeometryFoamState(),!!lake.locked,draft,{
    calculate:()=>void app.calculateLakeGeometryFoam(),cancel:()=>app.cancelLakeGeometryFoam(),clear:()=>app.clearLakeGeometryFoam(),
    edit:geometryFoam=>app.editLake({geometryFoam}),
  });
}
