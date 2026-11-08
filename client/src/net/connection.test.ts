import {afterEach,expect,it,vi} from 'vitest';
import {Connection} from './connection.ts';

afterEach(()=>vi.restoreAllMocks());
it.each([0,100,250])('keeps a delayed input batch on time at %i ms RTT without overflowing the movement queue',rtt=>{
  const connection=new Connection({status(){},sync(){},welcome(){},roster(){},snapshot(){}});
  vi.spyOn(connection,'serverTick','get').mockReturnValue(100);
  connection.rtt=rtt;
  const transitTicks=Math.ceil(rtt/2/(1000/60));
  const first=connection.firstTarget;
  // One tick to collect frame 2, two ticks of render jitter, one server step.
  for(const renderDelay of [0,1,2]){
    const receivedAt=100+1+renderDelay+transitTicks+1;
    expect(first).toBeGreaterThanOrEqual(receivedAt);
    expect(first+1-receivedAt+1).toBeLessThanOrEqual(6);
  }
});
