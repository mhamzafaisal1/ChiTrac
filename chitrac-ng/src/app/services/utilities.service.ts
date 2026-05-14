import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface RebootResponse {
  success: boolean;
  available: boolean;
  platform: string;
  scheduledForSeconds?: number;
  message?: string;
  error?: string;
  details?: string;
}

@Injectable({
  providedIn: 'root'
})
export class UtilitiesService {
  private apiUrl = '/api/utilities';

  constructor(private http: HttpClient) {}

  rebootServer(): Observable<RebootResponse> {
    return this.http.post<RebootResponse>(`${this.apiUrl}/reboot`, {});
  }
}
