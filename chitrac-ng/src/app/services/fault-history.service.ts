import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface FaultCycle {
  id: string;
  start: string;
  end: string;
  durationSeconds: number;
  code: number | null;
  name: string;
  machineSerial: number | null;
  machineName: string | null;
  operators: Array<{
    id: number;
    name: string;
    station: number;
  }>;
  items: any[];
  activeStations: number;
  workTimeMissedSeconds: number;
}

export interface FaultSummary {
  code: number | null;
  name: string;
  count: number;
  totalDurationSeconds: number;
  totalWorkTimeMissedSeconds: number;
  formatted: {
    hours: number;
    minutes: number;
    seconds: number;
  };
}

export interface FaultHistoryResponse {
  context: {
    start: string;
    end: string;
    serial?: number;
    machineName?: string;
    operatorId?: number;
    operatorName?: string;
  };
  faultCycles?: FaultCycle[];
  faultSummaries?: FaultSummary[];
}

// New type for the include parameter
export type FaultHistoryInclude = 'cycles' | 'summaries' | 'both';

@Injectable({
  providedIn: 'root'
})
export class FaultHistoryService {
  private apiUrl = '/api/alpha';

  constructor(private http: HttpClient) { }

  /**
   * Get fault history data for charts and analysis
   * @param start Start date string
   * @param end End date string
   * @param serial Optional machine serial number
   * @param operatorId Optional operator ID
   * @param include Optional parameter to specify which data to include ('cycles', 'summaries', or 'both')
   * @returns Observable with fault history data
   */
  getFaultHistory(
    start: string,
    end: string,
    serial?: number,
    operatorId?: number,
    include?: FaultHistoryInclude
  ): Observable<FaultHistoryResponse> {
    let params = new HttpParams()
      .set('start', start)
      .set('end', end);

    if (serial != null) {
      params = params.set('serial', serial.toString());
    }

    if (operatorId != null) {
      params = params.set('operatorId', operatorId.toString());
    }

    if (include != null) {
      params = params.set('include', include);
    }

    return this.http.get<FaultHistoryResponse>(`${this.apiUrl}/analytics/fault-sessions-history`, { params });
  }

  /**
   * Get fault history filtered by machine serial number
   * @param start Start date string
   * @param end End date string
   * @param serial Machine serial number
   * @param include Optional parameter to specify which data to include ('cycles', 'summaries', or 'both')
   * @returns Observable with fault history data for specific machine
   */
  getFaultHistoryBySerial(
    start: string,
    end: string,
    serial: number,
    include?: FaultHistoryInclude
  ): Observable<FaultHistoryResponse> {
    return this.getFaultHistory(start, end, serial, undefined, include);
  }

  /**
   * Get fault history filtered by operator ID
   * @param start Start date string
   * @param end End date string
   * @param operatorId Operator ID
   * @param include Optional parameter to specify which data to include ('cycles', 'summaries', or 'both')
   * @returns Observable with fault history data for specific operator
   */
  getFaultHistoryByOperator(
    start: string,
    end: string,
    operatorId: number,
    include?: FaultHistoryInclude
  ): Observable<FaultHistoryResponse> {
    return this.getFaultHistory(start, end, undefined, operatorId, include);
  }
}
