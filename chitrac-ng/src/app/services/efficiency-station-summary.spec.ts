import { BehaviorSubject } from 'rxjs';
import { EfficiencyScreensService } from './efficiency-screens.service';
import { configuredProductionStations } from '../efficiency-screens/experimental-spf/spf-stations';

describe('Exact configured-station live efficiency', () => {
  it('maps each station to its own operator, preserves machine fault/offline states, and never borrows another station’s metrics', () => {
    const stations=configuredProductionStations([{id:100,name:'Feeder',active:true,stations:[1,2,3]},{id:200,name:'Faulted',active:true,stations:[1]},{id:300,name:'Offline',active:true,stations:[1]}] as any);
    const operator=(station:number,value:number)=>({machine:{id:100,name:'Feeder'},operator:{id:station,name:'Operator '+station,station},status:1,stats:{lastSixMinutes:{efficiencyPercent:value,hasData:true}}});
    const cache=new BehaviorSubject<any>({dashboard:{production:{machines:{
      '100':{machine:{id:100},status:1,activeOperatorKeys:['two','one','foreign'],stats:{lastSixMinutes:{efficiencyPercent:999,hasData:true}}},
      '200':{machine:{id:200},status:4,fault:'Jam',statusSince:'2026-10-21T12:00:00Z',stats:{}},
    },operators:{two:operator(2,82),one:operator(1,91),foreign:{...operator(3,100),machine:{id:999}}}}}});
    const service=new EfficiencyScreensService({} as any,{ensureConnected(){},dashboardCache$:cache} as any);
    let result:any;service.getProductionStationSummaries(stations).subscribe(value=>result=value);
    expect(result['100:1'].operator).toBe('Operator 1');expect(result['100:1'].efficiency.lastSixMinutes.value).toBe(91);
    expect(result['100:2'].operator).toBe('Operator 2');expect(result['100:2'].efficiency.lastSixMinutes.value).toBe(82);
    expect(result['100:3'].operator).toBeNull();expect(result['100:3'].efficiency).toEqual({});
    expect(result['200:1'].status).toBe(4);expect(result['200:1'].latestFaultStart).toBe('2026-10-21T12:00:00Z');
    expect(result['300:1'].status).toBe(-1);expect(result['300:1'].machine).toBe('Offline — Station 1');
  });
  it('waits for production cache and cancels cleanly before it arrives', () => {
    const cache=new BehaviorSubject<any>({dashboard:{}});const service=new EfficiencyScreensService({}as any,{ensureConnected(){},dashboardCache$:cache}as any);
    let emitted=false;const sub=service.getProductionStationSummaries([]).subscribe(()=>emitted=true);
    expect(emitted).toBeFalse();sub.unsubscribe();expect(cache.observed).toBeFalse();
  });
});
