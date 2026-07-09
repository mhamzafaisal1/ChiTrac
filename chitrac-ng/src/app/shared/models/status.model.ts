import { Deserializable } from './deserializable.model';

export class StatusConfig implements Deserializable {
	public id: number;
	public code?: number;
	public name: string;
	public jam?: number;
	public color?: string;

	deserialize(input: any) {
        Object.assign(this, input);
        return this;
    }
}