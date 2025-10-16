import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface PermanentToken {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  lastUsed: Date | null;
  usageCount: number;
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
    createdAt: Date;
  };
}

export interface TokenListResponse {
  tokens: PermanentToken[];
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
}

