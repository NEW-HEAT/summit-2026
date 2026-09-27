import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createTreeSamples, FOREST_SITES, TREES_PER_SITE} from '../tree-demo/forest-data.ts';
import {landContains,crownOnLand,tileWaterFeatures} from '../tree-demo/land-guard.mjs';
const contains=landContains(JSON.parse(fs.readFileSync(new URL('../assets/land.json',import.meta.url))));

test('all seven grove footprints stay on land, with physical tree dimensions',()=>{
  const trees=createTreeSamples();
  assert.equal(TREES_PER_SITE,400);assert.equal(trees.length,2800);
  assert.deepEqual(trees,createTreeSamples());
  for(const tree of trees){
    assert.ok(crownOnLand(tree,contains),tree.id+' crown must stay on land');
    assert.ok(tree.height>1&&tree.height<33,tree.id+' height in metres');
    assert.ok(tree.canopyRadius>.5&&tree.canopyRadius<14,tree.id+' radius in metres');
    assert.equal(tree.position[2],0);
    const site=FOREST_SITES.find(s=>s.id===tree.siteId);
    const distance=Math.hypot((tree.position[0]-site.position[0])*111320*Math.cos(site.position[1]*Math.PI/180),(tree.position[1]-site.position[1])*111320);
    assert.ok(distance<250,tree.id+' must stay inside its local grove');
  }
  const tree=trees[0];
  assert.equal(crownOnLand({...tree,position:[-30,0,0]},contains),false,'Atlantic trees rejected');
  assert.equal(crownOnLand({...tree,position:[-150,0,0]},contains),false,'Pacific trees rejected');
});

test('land holes and crowns extending over the coast are rejected',()=>{
  const land=landContains({features:[{geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]],[[.4,.4],[.6,.4],[.6,.6],[.4,.6],[.4,.4]]]}}]});
  assert.equal(land([.5,.5]),false);
  assert.equal(land([.2,.2]),true);
  assert.equal(crownOnLand({position:[.000001,.2],canopyRadius:4},land),false);
});

test('local water tiles exclude trees in ponds as well as the ocean mask',()=>{
  const features=tileWaterFeatures({index:{x:8192,y:8192,z:14},content:[{properties:{layerName:'water'},geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}}]});
  const water=landContains({features});
  assert.equal(water([.01,-.01]),true);
  assert.equal(water([1,-1]),false);
  assert.equal(crownOnLand({position:[.01,-.01],canopyRadius:4},p=>!water(p)),false);
  assert.deepEqual(tileWaterFeatures({index:{z:2},content:[]}),[]);
});


test('WGS84 vector tiles preserve coordinates when filtering water',()=>{
  const tile={index:{z:14},content:[{properties:{layerName:'water'},geometry:{type:'Polygon',coordinates:[[[1,1],[2,1],[2,2],[1,2],[1,1]]]}}]};
  const water=landContains({features:tileWaterFeatures(tile,'wgs84')});
  assert.equal(water([1.5,1.5]),true);
  assert.equal(water([0,0]),false);
  assert.equal(crownOnLand({position:[1.5,1.5],canopyRadius:4},p=>!water(p)),false);
});
