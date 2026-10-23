import {prisma} from '../database/client.js';
import {z} from 'zod';
import {HEX_COLOR,cleanLine} from './profileCustomization.js';

/** Discord-style roles: lower position = higher priority (listed first, tints the name). */
export type PublicRole={id:string;key:string|null;name:string;color:string;icon:string;description:string;position:number;hoist:boolean};

export const DEFAULT_ROLES:Array<Omit<PublicRole,'id'>>=[
 {key:'owner',name:'Владелец',color:'#ff5c7a',icon:'crown',description:'Создатель Осколка',position:0,hoist:true},
 {key:'developer',name:'Разработчик',color:'#7c9cff',icon:'code',description:'Пишет код Осколка',position:1,hoist:true},
 {key:'idea',name:'Автор идеи',color:'#ffb547',icon:'lightbulb',description:'Придумал то, что стало частью Осколка',position:2,hoist:true},
 {key:'beta',name:'Бета-тестер',color:'#3ddc97',icon:'flask-conical',description:'Тестирует новые версии',position:3,hoist:true},
];
/** Reward roles (see rewardsCatalog medals); appended after whatever roles already exist. */
export const REWARD_ROLES:Array<Omit<PublicRole,'id'|'position'>>=[
 {key:'near_dev',name:'Около-разработчик',color:'#5aa9ff',icon:'zap',description:'Помогает разработке: идеи, разборы, тесты',hoist:true},
 {key:'contributor',name:'Контрибьютор',color:'#2bc4c4',icon:'pen-line',description:'Сделал вклад в сообщество: тексты, тайминги, источники',hoist:true},
];

/** Idempotent: creates the built-in roles once; never overwrites edits made in the admin panel. */
export async function seedDefaultRoles(){
 for(const role of DEFAULT_ROLES){
  const found=await prisma.role.findUnique({where:{key:role.key!}}).catch(()=>null);
  if(!found)await prisma.role.create({data:role}).catch(()=>{});
 }
 for(const role of REWARD_ROLES){
  const found=await prisma.role.findUnique({where:{key:role.key!}}).catch(()=>null);
  if(found)continue;
  const last=await prisma.role.findFirst({orderBy:{position:'desc'}}).catch(()=>null);
  await prisma.role.create({data:{...role,position:(last?.position??-1)+1}}).catch(()=>{});
 }
}

export const ROLE_ICONS=['crown','code','lightbulb','flask-conical','shield','star','heart','music','mic','pen-line','sparkles','bug','gem','zap','headphones','flame'] as const;
export class RoleValidationError extends Error{status=400;}
export const roleInputSchema=z.object({
 name:z.string().max(200).transform(cleanLine).pipe(z.string().min(1,'Название не может быть пустым.').max(32,'Название — до 32 символов.')),
 color:z.string().trim().regex(HEX_COLOR,'Цвет указывается в формате #RRGGBB.').transform(s=>s.toLowerCase()),
 icon:z.string().max(40).refine(s=>!s||(ROLE_ICONS as readonly string[]).includes(s)||[...s].length<=4,'Неизвестный значок.').default(''),
 description:z.string().max(400).transform(cleanLine).pipe(z.string().max(120,'Описание — до 120 символов.')).default(''),
 hoist:z.boolean().default(true),
});
export const rolePatchSchema=roleInputSchema.partial();

const pick=(r:any):PublicRole=>({id:r.id,key:r.key??null,name:r.name,color:r.color,icon:r.icon,description:r.description,position:r.position,hoist:r.hoist});
const byPriority=(a:PublicRole,b:PublicRole)=>a.position-b.position||a.name.localeCompare(b.name);

export async function listRoles(){
 const [roles,counts]=await Promise.all([prisma.role.findMany({orderBy:[{position:'asc'},{name:'asc'}]}),prisma.userRole.groupBy({by:['roleId'],_count:{_all:true}})]);
 const count=new Map(counts.map(c=>[c.roleId,c._count._all]));
 return roles.map(r=>({...pick(r),members:count.get(r.id)||0}));
}

/** Roles of many users in one query, each list sorted by priority. */
export async function rolesForUsers(userIds:string[]):Promise<Map<string,PublicRole[]>>{
 const out=new Map<string,PublicRole[]>();
 const ids=[...new Set(userIds.filter(Boolean))];
 if(!ids.length)return out;
 const links=await prisma.userRole.findMany({where:{userId:{in:ids}}}).catch(()=>[]);
 if(!links.length)return out;
 const roles=await prisma.role.findMany({where:{id:{in:[...new Set(links.map(l=>l.roleId))]}}});
 const byId=new Map(roles.map(r=>[r.id,pick(r)]));
 for(const l of links){const role=byId.get(l.roleId);if(role)out.set(l.userId,[...(out.get(l.userId)||[]),role]);}
 for(const list of out.values())list.sort(byPriority);
 return out;
}
export const rolesForUser=async(userId:string)=>(await rolesForUsers([userId])).get(userId)||[];

export async function createRole(input:unknown){
 const data=roleInputSchema.parse(input);
 const last=await prisma.role.findFirst({orderBy:{position:'desc'}});
 return pick(await prisma.role.create({data:{...data,position:(last?.position??-1)+1}}));
}
export async function updateRole(id:string,input:unknown){
 const data=rolePatchSchema.parse(input);
 return pick(await prisma.role.update({where:{id},data}));
}
export async function deleteRole(id:string){
 await prisma.$transaction([prisma.userRole.deleteMany({where:{roleId:id}}),prisma.role.delete({where:{id}})]);
}
/** Rewrites positions to match the given order; roles missing from it keep their relative order after. */
export async function reorderRoles(order:string[]){
 const roles=await prisma.role.findMany({orderBy:{position:'asc'}});
 const known=new Set(roles.map(r=>r.id));
 const ids=[...order.filter(id=>known.has(id)),...roles.map(r=>r.id).filter(id=>!order.includes(id))];
 await prisma.$transaction(ids.map((id,position)=>prisma.role.update({where:{id},data:{position}})));
 return listRoles();
}
export async function assignRole(roleId:string,userId:string){
 const [role,user]=await Promise.all([prisma.role.findUnique({where:{id:roleId}}),prisma.user.findUnique({where:{id:userId}})]);
 if(!role)throw new RoleValidationError('Роль не найдена.');
 if(!user)throw new RoleValidationError('Пользователь не найден.');
 await prisma.userRole.upsert({where:{userId_roleId:{userId,roleId}},create:{userId,roleId},update:{}});
}
export async function revokeRole(roleId:string,userId:string){
 await prisma.userRole.deleteMany({where:{roleId,userId}});
}
export async function roleMembers(roleId:string){
 const links=await prisma.userRole.findMany({where:{roleId},orderBy:{assignedAt:'desc'}});
 const users=await prisma.user.findMany({where:{id:{in:links.map(l=>l.userId)}},select:{id:true,name:true,username:true,avatarUrl:true}});
 const byId=new Map(users.map(u=>[u.id,u]));
 return links.flatMap(l=>{const u=byId.get(l.userId);return u?[{...u,assignedAt:l.assignedAt.toISOString()}]:[];});
}
