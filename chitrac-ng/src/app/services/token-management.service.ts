import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type ApiControllerId = 'general' | 'settings' | 'spindle' | 'milnor' | 'softrol';
export interface ApiControllerOption { id: ApiControllerId; label: string; }

export interface PermanentToken {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  timestamps: {
    create: Date;
    active: Date;
    update: Date;
    inactive?: Date;
  };
  lastUsed: Date | null;
  usageCount: number;
  allowedControllers: ApiControllerId[];
}

export interface CreateTokenRequest {
  name: string;
  description?: string;
}

export interface CreateTokenResponse {
  success: boolean;
  token: string;
  tokenInfo: {
    id: string;
    name: string;
    description: string;
    timestamps: PermanentToken['timestamps'];
    allowedControllers: ApiControllerId[];
  };
}

export interface TokenListResponse {
  controllers: ApiControllerOption[];
  tokens: PermanentToken[];
  deactivatedTokens: PermanentToken[];
}

@Injectable({
  providedIn: 'root'
})
export class TokenManagementService {
  private apiUrl = '/api/auth';

  constructor(private http: HttpClient) {}

  createPermanentToken(name: string, description: string = ''): Observable<CreateTokenResponse> {
    return this.http.post<CreateTokenResponse>(`${this.apiUrl}/createPermanentToken`, {
      name,
      description
    });
  }

  getTokens(): Observable<TokenListResponse> {
    return this.http.get<TokenListResponse>(`${this.apiUrl}/tokens`);
  }

  deleteToken(id: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(`${this.apiUrl}/tokens/${id}`);
  }

  updateControllerAccess(id: string, allowedControllers: ApiControllerId[]): Observable<{ success: boolean; allowedControllers: ApiControllerId[] }> {
    return this.http.put<{ success: boolean; allowedControllers: ApiControllerId[] }>(
      `${this.apiUrl}/tokens/${id}/controllers`, { allowedControllers },
      { headers: { 'X-Skip-Error-Modal': 'true' } }
    );
  }
}

