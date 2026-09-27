import test from 'node:test';import assert from 'node:assert/strict';
import {people,connections,personAlpha,connectionAlpha,connectionStats,NODE_ALTITUDE,ARC_STYLE} from '../scenes/people-network.mjs';
test('the same people and links fade together without dangling edges',()=>{
 assert.deepEqual(connectionStats(0),{points:96,arcs:480});assert.deepEqual(connectionStats(20),{points:7,arcs:6});
 for(let p=0;p<=20;p+=.125)for(const edge of connections){const a=connectionAlpha(edge,p);assert.equal(a,Math.min(personAlpha(edge.from,p),personAlpha(edge.to,p)));}
 for(const person of people.filter(p=>!p.keep)){const p=person.fadeAt-1.5;assert.ok(personAlpha(person,p)>0&&personAlpha(person,p)<1);for(const edge of connections.filter(e=>e.from===person||e.to===person))assert.ok(connectionAlpha(edge,p)<=personAlpha(person,p));}
});
test('all arcs are unique and share a single style and node endpoint altitude',()=>{
 assert.equal(new Set(connections.map(e=>[e.from.id,e.to.id].sort((a,b)=>a-b).join(':'))).size,connections.length);
 for(const e of connections){assert.notEqual(e.from,e.to);assert.equal(e.from.position[2],NODE_ALTITUDE);assert.equal(e.to.position[2],NODE_ALTITUDE)}
 assert.equal(typeof ARC_STYLE.getWidth,'number');assert.equal(typeof ARC_STYLE.getHeight,'number');assert.equal(ARC_STYLE.greatCircle,true);
});
