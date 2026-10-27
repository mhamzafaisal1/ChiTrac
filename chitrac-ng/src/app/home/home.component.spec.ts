import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { HomeComponent } from './home.component';
import { User, UserService } from '../user.service';
import { NavigationActionsService } from '../services/navigation-actions.service';
import { ProductionScreenLayoutsService } from '../services/production-screen-layouts.service';
import { UserLoginComponent } from '../user-login/user-login.component';
import { PasswordResetComponent } from '../password-reset/password-reset.component';
import { routes } from '../app.routes';

@Component({standalone:true,template:''}) class ReturnTarget {}

describe('Home login gate and DMC menu grid', () => {
  let users: BehaviorSubject<User | null>, library: BehaviorSubject<any>;
  let completed: Subject<void>, closed: Subject<void>, dialog: any, ref: any;
  const admin: User = {username:'admin',permissions:{level:0}};
  beforeEach(() => {
    users = new BehaviorSubject<User | null>(null);
    library = new BehaviorSubject({systemLayouts:[{scope:'system',id:'a'.repeat(64),name:'Line A'}],userLayouts:[{scope:'user',id:'a'.repeat(64),name:'Line A'}],loading:false,error:''});
    completed=new Subject(); closed=new Subject();
    ref={componentInstance:{closeModal:completed},close:jasmine.createSpy('close').and.callFake(()=>closed.next()),afterClosed:()=>closed};
    dialog={open:jasmine.createSpy('open').and.returnValue(ref)};
    TestBed.configureTestingModule({imports:[HomeComponent],providers:[provideNoopAnimations(),provideRouter([
      {path:'ng/home',component:HomeComponent},
      routes.find(route=>route.path==='ng/login')!,routes.find(route=>route.path==='ng/reset-password')!,
      {path:'ng/return-target',component:ReturnTarget},
    ]),
      {provide:UserService,useValue:{user:users,hasPermissionLevel:(level:number,user:User|null)=>typeof user?.permissions?.level==='number' && user.permissions.level<=level}},
      {provide:ProductionScreenLayoutsService,useValue:{state$:library,refresh:jasmine.createSpy('refresh')}},
      {provide:MatDialog,useValue:dialog},
    ]});
  });
  const labels=(h:RouterTestingHarness)=>Array.from(h.routeNativeElement!.querySelectorAll('.tile-label')).map(node=>node.textContent!.trim());
  async function press(h:RouterTestingHarness,name:string) {
    const label=Array.from(h.routeNativeElement!.querySelectorAll('.tile-label')).find(node=>node.textContent!.trim()===name)!;
    (label.closest('a,button') as HTMLElement).click(); await h.fixture.whenStable(); h.detectChanges();
  }

  it('shows exactly one Login button and no navigation links for anonymous visitors, including submenu URLs',async()=>{
    const h=await RouterTestingHarness.create('/ng/home?menu=reports');
    expect(labels(h)).toEqual(['Login']);expect(h.routeNativeElement!.querySelectorAll('button').length).toBe(1);
    expect(h.routeNativeElement!.querySelectorAll('a').length).toBe(0);
    await press(h,'Login');await press(h,'Login');expect(dialog.open).toHaveBeenCalledTimes(1);
    expect(dialog.open.calls.mostRecent().args[0]).toBe(UserLoginComponent);
  });

  it('places Main Menu first and retains the existing signed-in shortcuts',async()=>{
    users.next(admin);const h=await RouterTestingHarness.create('/ng/home');
    expect(labels(h)).toEqual(['Main Menu','Daily Dashboard','Machine Dashboard','Operator Dashboard','Comparison Dashboard','Machine Report','Operator Report','Settings','Log Out']);
    await press(h,'Main Menu');expect(labels(h)).toEqual(['Home','Dashboards','Production Screens','Reports','Settings','Log Out']);
    await press(h,'Dashboards');expect(labels(h)).toEqual(['Back','Daily','Machine','Operator','Item','Summary','Comparison','Experimental']);
    await press(h,'Experimental');expect(labels(h)).toContain('Action Center');await press(h,'Back');expect(labels(h)).toContain('Daily');
    await press(h,'Back');await press(h,'Reports');expect(labels(h)).toContain('Shift Comparison Report');
  });

  it('uses the same production destinations, with distinct scope links for identically named saved layouts',async()=>{
    users.next(admin);const h=await RouterTestingHarness.create('/ng/home?menu=productionScreens');
    expect(labels(h)).toEqual(['Back','Production Screen','Line A','Line A']);
    const links=Array.from(h.routeNativeElement!.querySelectorAll('a')) as HTMLAnchorElement[];
    const named=links.filter(link=>link.search.includes('layoutId='));
    expect(named.length).toBe(2);expect(named[0].search).toContain('layoutScope=system');expect(named[1].search).toContain('layoutScope=user');
    const generic=links.find(link=>link.pathname==='/ng/production-screen' && !link.search);expect(generic).toBeDefined();
  });

  it('hides permission-restricted entries and immediately hides all navigation after logout',async()=>{
    users.next({username:'viewer',permissions:{level:8}});const h=await RouterTestingHarness.create('/ng/home');
    expect(labels(h)).not.toContain('Settings');await press(h,'Main Menu');expect(labels(h)).not.toContain('Settings');
    users.next(null);h.detectChanges();expect(labels(h)).toEqual(['Login']);
  });

  it('keeps the signed-in logout action in the shared user menu',async()=>{
    users.next(admin);const h=await RouterTestingHarness.create('/ng/home');
    const actions:string[]=[];const sub=TestBed.inject(NavigationActionsService).requests$.subscribe(value=>actions.push(value));
    await press(h,'Log Out');expect(actions).toEqual(['authentication']);sub.unsubscribe();
  });

  it('redirects old login links to Home and restores a local protected destination after successful login',async()=>{
    const h=await RouterTestingHarness.create('/ng/login?returnUrl=%2Fng%2Freturn-target');
    expect(TestBed.inject(Router).url).toContain('/ng/home');expect(dialog.open).toHaveBeenCalledTimes(1);
    users.next(admin);completed.next();await h.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/ng/return-target');expect(ref.close).toHaveBeenCalled();
  });

  it('never follows an external login return URL',async()=>{
    const h=await RouterTestingHarness.create('/ng/home?returnUrl=https%3A%2F%2Fexample.test');
    await press(h,'Login');users.next(admin);completed.next();await h.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/ng/home');
  });

  it('handles existing password-reset links in a Home dialog with the original token',async()=>{
    const h=await RouterTestingHarness.create('/ng/reset-password?token=test-reset-token');
    expect(TestBed.inject(Router).url).toContain('/ng/home?resetPassword=1');
    expect(dialog.open.calls.mostRecent().args[0]).toBe(PasswordResetComponent);
    const injector=dialog.open.calls.mostRecent().args[1].injector;
    expect(injector.get(ActivatedRoute).snapshot.queryParamMap.get('token')).toBe('test-reset-token');
    expect(labels(h)).toEqual(['Login']);
  });

  it('keeps Home as the only public component route and the default/fallback destination',()=>{
    const publicPages=routes.filter(route=>route.redirectTo===undefined && !route.canActivate?.length);
    expect(publicPages.map(route=>route.path)).toEqual(['ng/home']);
    expect(routes.find(route=>route.path==='')?.redirectTo).toBe('ng/home');
    expect(routes.find(route=>route.path==='**')?.redirectTo).toBe('ng/home');
  });
});
