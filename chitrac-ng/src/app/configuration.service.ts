/** Angular imports */
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';

/** Other module imports */
import { Observable } from 'rxjs';
import { map, take } from 'rxjs/operators';
import { ConfigurationCacheService } from './services/configuration-cache.service';

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
  private readonly locallyHandledErrorOptions = {
    headers: new HttpHeaders({ 'X-Skip-Error-Modal': 'true' })
  };

  constructor(private http: HttpClient, private readonly cache: ConfigurationCacheService) { }

  /** Fault */
  public getFaultConfigs(code?: number): Observable<FaultConfig[]> {
    return this.cache.read<FaultConfig>('fault');
  }

  /** Status */
  public getStatusConfigs(code?: number): Observable<StatusConfig[]> {
    return this.cache.read<StatusConfig>('status');
  }

  /** Operator */
  public getOperatorConfigs(): Observable<OperatorConfig[]> {
    return this.watchOperatorConfigs().pipe(take(1));
  }

  public watchOperatorConfigs(): Observable<OperatorConfig[]> {
    return this.cache.watch<OperatorConfig>('operator').pipe(map(rows => rows.filter(row => {
      const id = (row as any).id ?? (row as any).code;
      return id != null && Number(id) <= 500000;
    })));
  }

  public watchMachineConfigs(): Observable<MachineConfig[]> { return this.cache.watch<MachineConfig>('machine'); }
  public watchItemConfigs(): Observable<ItemConfig[]> { return this.cache.watch<ItemConfig>('item'); }

  public getNewOperatorId(): Observable<{id: number}> {
    return this.http.get<{id: number}>('/api/operator/new-id');
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
    return this.cache.read<ItemConfig>('item');
  }

  public getNewItemId(): Observable<{id: number}> {
    return this.http.get<{id: number}>('/api/item/new-id');
  }

  private buildItemPayload(item: ItemConfig): ItemConfig | FormData {
    if (!item.photoFile) return item;

    const formData = new FormData();
    Object.entries(item).forEach(([key, value]) => {
      if (key === 'photoFile' || value === undefined) return;
      formData.append(key, value === null ? '' : String(value));
    });
    formData.append('photoFile', item.photoFile);
    return formData;
  }

  public postItemConfig(item: ItemConfig, applyAfterMachinesOffline = false): Observable<ItemConfig> {
    const url = applyAfterMachinesOffline
      ? '/api/item/config?applyAfterMachinesOffline=true'
      : '/api/item/config';
    return this.http.post<ItemConfig>(url, this.buildItemPayload(item));
  }

  // public putItemConfig(item: ItemConfig): Observable<ItemConfig> {
  //   return this.http.put<ItemConfig>('/api/item/config', item);
  // }

  

  public putItemConfig(item: ItemConfig, applyAfterMachinesOffline = false): Observable<ItemConfig> {
    const url = applyAfterMachinesOffline
      ? `/api/item/config/${item._id}?applyAfterMachinesOffline=true`
      : `/api/item/config/${item._id}`;
    return this.http.put<ItemConfig>(url, this.buildItemPayload(item));
  }
  

  public deleteItemConfig(_id: string): Observable<ItemConfig> {
    return this.http.delete<ItemConfig>('/api/item/config/' + _id);
  }

  /** ✅ Machine */
  public getMachineConfigs(): Observable<MachineConfig[]> {
    return this.cache.read<MachineConfig>('machine');
  }

  public postMachineConfig(machine: MachineConfig): Observable<MachineConfig> {
    return this.http.post<MachineConfig>(
      '/api/machine/config',
      machine,
      this.locallyHandledErrorOptions
    );
  }

  public putMachineConfig(machine: MachineConfig): Observable<MachineConfig> {
    return this.http.put<MachineConfig>(
      `/api/machine/config/${machine._id}`,
      machine,
      this.locallyHandledErrorOptions
    );
  }

  public deleteMachineConfig(_id: string): Observable<MachineConfig> {
    return this.http.delete<MachineConfig>(`/api/machine/config/${_id}`);
  }
}
