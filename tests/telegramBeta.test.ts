import {beforeEach,describe,it,expect,vi} from 'vitest';
const db=vi.hoisted(()=>({findUnique:vi.fn(),updateMany:vi.fn(),findFirst:vi.fn(),upsert:vi.fn()}));
vi.mock('../server/src/database/client.js',()=>({prisma:{betaAccess:db}}));
import {checkBetaAccess,seedBetaAccess} from '../server/src/services/telegramBeta.js';
beforeEach(()=>vi.resetAllMocks());
describe('beta access binds a verified identity',()=>{
 it('never gives an invitation to a new owner of a recycled username',async()=>{db.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({id:'invite',enabled:true,telegramUserId:'telegram:1'});expect(await checkBetaAccess('telegram:2','pexepo')).toBe(false);expect(db.updateMany).not.toHaveBeenCalled();});
 it('binds the first verified ID atomically',async()=>{db.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({id:'invite',enabled:true,telegramUserId:null});db.updateMany.mockResolvedValue({count:1});expect(await checkBetaAccess('telegram:1','PeXePo')).toBe(true);expect(db.updateMany).toHaveBeenCalledWith({where:{id:'invite',enabled:true,telegramUserId:null},data:{telegramUserId:'telegram:1'}});});
 it('keeps revoked binding denied after a username change',async()=>{db.findUnique.mockResolvedValue({enabled:false,telegramUserId:'telegram:1'});expect(await checkBetaAccess('telegram:1','new_name')).toBe(false);});
 it('does not re-enable revoked invitations during bootstrap',async()=>{vi.stubEnv('TELEGRAM_BETA_USERNAMES','@pexepo');await seedBetaAccess();expect(db.upsert).toHaveBeenCalledWith({where:{username:'pexepo'},create:{username:'pexepo',enabled:true},update:{}});vi.unstubAllEnvs();});
});
