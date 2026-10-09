import {EntitySelection, Graph, Relationship} from '@neo4j-arrows/model'
import {VisualNode} from './VisualNode';
import { VisualAttachment } from './VisualAttachment';

export class ResolvedRelationship {
  // VisualRelationship gates the type caption on this being set; the JS original assigned
  // it in the constructor and the TS port dropped it, so no relationship type was drawn.
  get type() { return this.relationship.type}
  get id() { return this.relationship.id}
  constructor(
    readonly relationship:Relationship, 
    readonly from:VisualNode, 
    readonly to:VisualNode, 
    readonly startAttachment:VisualAttachment, 
    readonly endAttachment:VisualAttachment, 
    readonly selected:boolean,
    readonly graph:Graph
  ) {}
}