import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ErrorQueueService } from './services/error-queue.service';

@Injectable()
export class ErrorInterceptor implements HttpInterceptor {
  
  constructor(private errorQueueService: ErrorQueueService) {}
  
  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    return next.handle(req).pipe(
      catchError((error: HttpErrorResponse) => {
        // Only handle HTTP errors (not client-side errors like network issues)
        if (error.error instanceof ErrorEvent) {
          // Client-side error (network error, etc.)
          this.errorQueueService.addError({
            message: `Network Error: ${error.error.message}`,
            statusCode: 0,
            endpoint: req.url,
            fullError: {
              type: 'NetworkError',
              message: error.error.message,
              method: req.method,
              url: req.url
            }
          });
        } else {
          // Server-side error
          const errorMessage = this.extractErrorMessage(error);
          
          this.errorQueueService.addError({
            message: errorMessage,
            statusCode: error.status,
            endpoint: req.url,
            fullError: {
              status: error.status,
              statusText: error.statusText,
              method: req.method,
              url: req.url,
              error: error.error,
              headers: this.extractHeaders(error)
            }
          });
        }
        
        // Re-throw the error so components can still handle it if needed
        return throwError(() => error);
      })
    );
  }

  /**
   * Extract a user-friendly error message from the HTTP error response
   */
  private extractErrorMessage(error: HttpErrorResponse): string {
    // Try to extract message from various possible error response formats
    if (error.error?.message) {
      return error.error.message;
    }
    
    if (error.error?.error) {
      if (typeof error.error.error === 'string') {
        return error.error.error;
      }
      if (error.error.error.message) {
        return error.error.error.message;
      }
    }
    
    if (typeof error.error === 'string') {
      return error.error;
    }
    
    // Default messages based on status code
    switch (error.status) {
      case 0:
        return 'Unable to connect to the server. Please check your network connection.';
      case 400:
        return 'Bad Request: The server could not understand the request.';
      case 401:
        return 'Unauthorized: Please log in to continue.';
      case 403:
        return 'Forbidden: You do not have permission to access this resource.';
      case 404:
        return 'Not Found: The requested resource could not be found.';
      case 408:
        return 'Request Timeout: The server took too long to respond.';
      case 409:
        return 'Conflict: The request conflicts with the current state of the server.';
      case 422:
        return 'Unprocessable Entity: The request was well-formed but contains invalid data.';
      case 429:
        return 'Too Many Requests: You have made too many requests. Please try again later.';
      case 500:
        return 'Internal Server Error: Something went wrong on the server.';
      case 502:
        return 'Bad Gateway: The server received an invalid response.';
      case 503:
        return 'Service Unavailable: The server is temporarily unavailable.';
      case 504:
        return 'Gateway Timeout: The server did not respond in time.';
      default:
        return `An error occurred: ${error.statusText || 'Unknown error'}`;
    }
  }

  /**
   * Extract relevant headers from the error response
   */
  private extractHeaders(error: HttpErrorResponse): any {
    const headers: any = {};
    if (error.headers) {
      error.headers.keys().forEach(key => {
        headers[key] = error.headers.get(key);
      });
    }
    return headers;
  }
}

