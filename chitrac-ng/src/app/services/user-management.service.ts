import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ManagedUser {
  _id: string;
  username: string;
  email: string;
  role: string;
  groups: string[];
  restrictions: string[];
  active: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface UserListResponse {
  users: ManagedUser[];
}

export interface UserResponse {
  user: ManagedUser;
}

export interface UserSaveRequest {
  username: string;
  password?: string;
  email?: string;
  role?: string;
  groups?: string[];
  restrictions?: string[];
  active?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class UserManagementService {
  private apiUrl = '/api/users';

  constructor(private http: HttpClient) {}

  getUsers(): Observable<UserListResponse> {
    return this.http.get<UserListResponse>(this.apiUrl);
  }

  createUser(user: UserSaveRequest): Observable<UserResponse> {
    return this.http.post<UserResponse>(this.apiUrl, user);
  }

  updateUser(id: string, user: UserSaveRequest): Observable<UserResponse> {
    return this.http.put<UserResponse>(`${this.apiUrl}/${id}`, user);
  }

  deleteUser(id: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(`${this.apiUrl}/${id}`);
  }
}
