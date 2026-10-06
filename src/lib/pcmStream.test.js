import { describe, expect, it } from 'vitest';
import { PcmStream } from '../../public/pcm-stream-core.js';
const signal = n => Float32Array.from({length:n},(_,i)=>.35*Math.sin(2*Math.PI*437*i/24000)+.15*Math.sin(2*Math.PI*1703*i/24000));
function render(engine, frames) {const output=new Float32Array(frames);for(let i=0;i<frames;i+=128)engine.render(output.subarray(i,Math.min(i+128,frames)));return output;}
describe('continuous audio render core',()=>{
 it.each([24000,44100,48000])('is identical for whole and irregular packets at %i Hz',rate=>{
  const pcm=signal(48000),whole=new PcmStream(rate),split=new PcmStream(rate);whole.start();split.start();whole.push(pcm);
  for(let i=0;i<pcm.length;i+=961)split.push(pcm.subarray(i,i+961));whole.end();split.end();
  expect(render(split,rate*2+256)).toEqual(render(whole,rate*2+256));expect(split.complete).toBe(true);
 });
 it('absorbs arrival jitter without changing samples or adding gaps',()=>{
  const pcm=signal(24000),stream=new PcmStream(24000),reference=new PcmStream(24000);stream.start();reference.start();reference.push(pcm);reference.end();stream.push(pcm.subarray(0,7200));
  const result=new Float32Array(24128);for(let i=0;i<result.length;i+=128){if(i===4096)stream.push(pcm.subarray(7200,14400));if(i===11264){stream.push(pcm.subarray(14400));stream.end();}stream.render(result.subarray(i,Math.min(i+128,result.length)));}
  expect(result).toEqual(render(reference,result.length));expect(stream.underruns).toBe(0);
 });
 it('buffers initial fragments, flushes short replies, and smooths a real underrun',()=>{
  const engine=new PcmStream(24000);engine.start();engine.push(new Float32Array(1000).fill(.8));expect(render(engine,128).every(x=>x===0)).toBe(true);engine.end();const short=render(engine,1152);expect(short.some(x=>x>0)).toBe(true);expect(engine.complete).toBe(true);
  engine.start();engine.push(new Float32Array(4000).fill(.8));const starved=render(engine,5000);let jump=0;for(let i=1;i<starved.length;i++)jump=Math.max(jump,Math.abs(starved[i]-starved[i-1]));expect(jump).toBeLessThan(.012);expect(engine.underruns).toBe(1);
  engine.push(new Float32Array(4000).fill(.5));engine.end();expect(render(engine,4300).some(x=>x>0)).toBe(true);expect(engine.complete).toBe(true);
 });
 it('discards queued audio on stop and does not report a cancelled stream as finished',()=>{
  const engine=new PcmStream(24000);engine.start();engine.push(signal(12000));render(engine,512);engine.stop();expect(render(engine,512).slice(100).every(x=>x===0)).toBe(true);expect(engine.complete).toBe(false);
  engine.start();engine.push(new Float32Array(300));engine.end();expect(render(engine,512).every(x=>x===0)).toBe(true);
 });
});
