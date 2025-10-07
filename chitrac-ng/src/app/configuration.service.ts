/** Angular imports */
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

/** Other module imports */
import { Observable } from 'rxjs';

/** Model imports */
import { FaultConfig } from './shared/models/fault.model';
import { StatusConfig } from './shared/models/status.model';
import { OperatorConfig } from './shared/models/operator.model';
import { ItemConfig } from './shared/models/item.model';
import { MachineConfig } from './shared/models/machine.model';

@Injectable({
  providedIn: 'root'
})
export class ConfigurationService {

  constructor(private http: HttpClient) { }

  /** Fault */
  public getFaultConfigs(code?: number): Observable<FaultConfig[]> {
    return this.http.get<FaultConfig[]>('/api/faults/config');
  }

  /** Status */
  public getStatusConfigs(code?: number): Observable<StatusConfig[]> {
    return this.http.get<StatusConfig[]>('/api/status/config');
  }

  /** Operator */
  public getOperatorConfigs(): Observable<OperatorConfig[]> {
    return this.http.get<OperatorConfig[]>('/api/operator/config?filterTestOperators=true');
  }

  public getNewOperatorId(): Observable<{code: number}> {
    return this.http.get<{code: number}>('/api/operator/new-id');
  }

  public postOperatorConfig(operator: OperatorConfig) {
    return this.http.post<OperatorConfig>('/api/operator/config', operator);
  }

  public putOperatorConfig(operator: OperatorConfig) {
    return this.http.put<OperatorConfig>(`/api/operator/config/${operator._id}`, operator);
  }

  public deleteOperatorConfig(id: string) {
    return this.http.delete<OperatorConfig>(`/api/operator/config/${id}`);
  }

  /** Item */
  public getItemConfigs(): Observable<ItemConfig[]> {
    return this.http.get<ItemConfig[]>('/api/item/config');
  }

  public postItemConfig(item: ItemConfig): Observable<ItemConfig> {
    return this.http.post<ItemConfig>('/api/item/config', item);
  }

  // public putItemConfig(item: ItemConfig): Observable<ItemConfig> {
  //   return this.http.put<ItemConfig>('/api/item/config', item);
  // }

  

  public putItemConfig(item: ItemConfig): Observable<ItemConfig> {
    return this.http.put<ItemConfig>(`/api/item/config/${item._id}`, item);
  }
  

  public deleteItemConfig(_id: string): Observable<ItemConfig> {
    return this.http.delete<ItemConfig>('/api/item/config/' + _id);
  }

  /** ✅ Machine */
  public getMachineConfigs(): Observable<MachineConfig[]> {
    return this.http.get<MachineConfig[]>('/api/machines/config');
  }

  public postMachineConfig(machine: MachineConfig): Observable<MachineConfig> {
    return this.http.post<MachineConfig>('/api/machines/config', machine);
  }

  public putMachineConfig(machine: MachineConfig): Observable<MachineConfig> {
    return this.http.put<MachineConfig>(`/api/machines/config/${machine._id}`, machine);
  }

  public deleteMachineConfig(_id: string): Observable<MachineConfig> {
    return this.http.delete<MachineConfig>(`/api/machines/config/${_id}`);
  }
}
