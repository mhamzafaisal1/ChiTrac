import { Deserializable } from './deserializable.model';

export class AlarmConfig implements Deserializable {
  public _id?: string;
  public id: number;
  public name: string;
  public active: boolean;
  public fault: boolean;
  public stop: boolean;
  public alarmValue?: number;
  public alarmCode?: number;
  public jam?: number;
  public color?: string;
  public timestamps?: Record<string, string>;

  deserialize(input: any) {
    Object.assign(this, input);
    return this;
  }
}
