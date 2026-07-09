import { Deserializable } from './deserializable.model';

export interface MachineIpAddress {
  firstOctet: number;
  secondOctet: number;
  thirdOctet: number;
  fourthOctet: number;
}

export class MachineConfig implements Deserializable {
  public _id: string;
  public id: number;
  public name: string;
  public active: boolean;
  public ipAddress: MachineIpAddress;
  public lanes: number[];
  public stations: number[];
  public type: string;
  public polled: boolean;
  public simulated?: boolean;
  public timestamps?: any;
  public groups?: {
    area?: string;
    category?: string;
    department?: string;
  };

  deserialize(input: any) {
    Object.assign(this, input);
    return this;
  }
}
