import assert from "node:assert/strict";
import test from "node:test";
import { rectangle, rectangleOverlap, clipSegment, rectangleSegmentDistance, clipHeightTriangle, polygonArea, terrainRectangleStats, terrainSegmentProfile } from "../../tools/world/siteReview.mjs";

test("site review: rectangle/segment distance detects crossing and corner touches, without false footprint overlap", () => {
  const box = rectangle([0, 0], [4, 2]);
  assert.equal(rectangleSegmentDistance(box, [-3, 0], [3, 0]).distance, 0);
  assert.equal(rectangleSegmentDistance(box, [3, -5], [3, 5]).distance, 1);
  assert.equal(clipSegment([-3, -2], [-2, -1], box).lo, 1);
  assert.equal(clipSegment([3, -5], [3, 5], box), null);
  assert.equal(rectangleOverlap(box, rectangle([4, 0], [4, 2])), false, "a touching boundary is not an area overlap");
  assert.equal(rectangleOverlap(box, rectangle([3.99, 0], [4, 2])), true);
});

test("site review: clipped triangle preserves plane heights at new edge intersections", () => {
  const clipped = clipHeightTriangle([[0,0,0],[2,0,2],[0,2,4]],{min:[0.25,0.25],max:[0.75,0.75]});
  assert.ok(Math.abs(polygonArea(clipped)-0.25)<1e-12);
  for(const [x,y,h] of clipped)assert.ok(Math.abs(h-x-2*y)<1e-12);
});

test("site review: exact footprint and diagnostic pad relief on a sloped plane", () => {
  const grid = {min:[100,200],max:[112,212],width:3,height:3,spacing:6,vertex:(x,y)=>10+x*3+y*1.2};
  const box={min:[101,201],max:[111,211]}, stats=terrainRectangleStats(box,grid);
  assert.ok(Math.abs(stats.heightSpread-7)<1e-10);
  assert.ok(Math.abs(stats.maxGradePercent-Math.hypot(0.5,0.2)*100)<1e-10);
  assert.ok(Math.abs(stats.maxCutOrFillToMidrange-3.5)<1e-10);
  assert.equal(terrainRectangleStats({min:[99,201],max:[111,211]},grid),null);
});

test("site review: collider diagonal is piecewise triangular, not bilinear", () => {
  const grid={min:[0,0],max:[1,1],width:2,height:2,spacing:1,vertex:(x,y)=>x===1&&y===1?10:0};
  const stats=terrainRectangleStats({min:[0.25,0.25],max:[0.75,0.75]},grid);
  assert.equal(stats.minHeight,0);
  assert.equal(stats.maxHeight,5);
});

test("site review: an internal terrain peak cannot be missed by a four-corner footprint check", () => {
  const grid={min:[0,0],max:[3,3],width:4,height:4,spacing:1,vertex:(x,y)=>x===1&&y===1?10:0};
  const stats=terrainRectangleStats({min:[0.5,0.5],max:[2.5,2.5]},grid);
  assert.equal(stats.maxHeight,10);
  assert.equal(stats.minHeight,0);
});

test("site review: a straight link splits at the collider diagonal and cannot average away a steep leg", () => {
  const grid={min:[0,0],max:[1,1],width:2,height:2,spacing:1};
  const profile=terrainSegmentProfile([0.25,0.25],[0.75,0.75],grid,(x,y)=>Math.max(0,x+y-1)*10);
  assert.ok(Math.abs(profile.maxGradePercent-Math.SQRT2*1000)<1e-8);
  assert.equal(terrainSegmentProfile([-0.1,0],[0,0],grid,()=>0),null);
  assert.equal(terrainSegmentProfile([0,0],[0,0],grid,()=>10).maxGradePercent,0);
});
