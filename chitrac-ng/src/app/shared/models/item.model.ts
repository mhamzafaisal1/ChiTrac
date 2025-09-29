import { Deserializable } from './deserializable.model';

export class ItemConfig implements Deserializable {
	public _id: string;
	public number: number;
	public name: string;
	public active: boolean;
	public weight?: number | null; // optional field
	public standard?: number; // pieces per hour standard
	public area?: number; // area id (currently unused)
	public department?: string; // department name

	deserialize(input: any) {
		Object.assign(this, input);
		return this;
	}
}
