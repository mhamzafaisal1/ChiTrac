import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { AppComponent } from './app.component';
import { NavMainMenuComponent } from './nav-main-menu/nav-main-menu.component';
import { NavigationFeedbackComponent } from './components/navigation-feedback/navigation-feedback.component';
import { UserService } from './user.service';
import { SettingsService } from './services/settings.service';
import { WebsocketService } from './services/websocket.service';
import { ErrorQueueService } from './services/error-queue.service';

@Component({selector:'nav-main-menu',standalone:true,template:'<button>Open main menu</button>'})
class NavStub { @Input() isDarkMode=false; @Output() darkModeToggleEvent=new EventEmitter(); }
@Component({selector:'app-navigation-feedback',standalone:true,template:''})
class FeedbackStub { pending=()=>false; }

describe('Application navigation shell', () => {
  let users:BehaviorSubject<any>, socket:any;
  beforeEach(()=>{
    users=new BehaviorSubject(null);socket={ensureConnected:jasmine.createSpy(),resetSession:jasmine.createSpy()};
    const defaults={defaultTheme:'dark',showErrorModals:true};
    TestBed.configureTestingModule({imports:[AppComponent],providers:[provideRouter([]),
      {provide:UserService,useValue:{user:users,getCurrentUser:()=>of(null)}},
      {provide:SettingsService,useValue:{loadSettings:()=>of(defaults),getSettings:()=>defaults,clearUserPreferences(){},loadUserPreferences:()=>of({}),getUserTheme:()=>of({theme:'dark'})}},
      {provide:WebsocketService,useValue:socket},
      {provide:ErrorQueueService,useValue:{setShowErrorModals(){}}},
    ]}).overrideComponent(AppComponent,{remove:{imports:[NavMainMenuComponent,NavigationFeedbackComponent]},add:{imports:[NavStub,FeedbackStub]}});
  });
  it('renders the toolbar without starting a live feed for anonymous visitors',()=>{
    const fixture=TestBed.createComponent(AppComponent);fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('nav-main-menu')).not.toBeNull();
    expect(socket.ensureConnected).not.toHaveBeenCalled();expect(socket.resetSession).toHaveBeenCalled();fixture.destroy();
  });
  it('keeps the navigation shell mounted across login and logout',()=>{
    const fixture=TestBed.createComponent(AppComponent);fixture.detectChanges();
    const navigation=fixture.nativeElement.querySelector('nav-main-menu');
    users.next({username:'admin'});fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('nav-main-menu button')).not.toBeNull();
    expect(socket.ensureConnected).toHaveBeenCalled();
    users.next(null);fixture.detectChanges();expect(fixture.nativeElement.querySelector('nav-main-menu')).toBe(navigation);fixture.destroy();
  });
});
