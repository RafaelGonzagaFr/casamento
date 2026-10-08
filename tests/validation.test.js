import test from 'node:test';
import assert from 'node:assert/strict';
import { giftData,imageData,settingsData,uuid,id } from '../server/validation.js';
test('links executáveis, valores negativos e IDs inválidos são rejeitados',() => {
 const body={name:'Presente',category_id:1};
 assert.throws(()=>giftData({...body,external_url:'javascript:alert(1)'}),/http/);
 assert.throws(()=>giftData({...body,estimated_price:-1}),/Valor/);
 assert.throws(()=>giftData({...body,estimated_price:'abc'}),/Valor/);
 assert.throws(()=>id('1 OR 1=1'),/inválido/);
 assert.throws(()=>uuid('qualquer'),/inválido/);
 assert.equal(giftData({...body,external_url:'https://example.com',estimated_price:2.345}).estimated_price,2.35);
});
test('uploads têm limite de 2 MB e assinatura compatível com MIME',() => {
 assert.throws(()=>imageData({type:'image/png',base64:Buffer.from('<script>').toString('base64')}),/válida/);
 assert.throws(()=>imageData({type:'image/png',base64:Buffer.alloc(2097153).toString('base64')}),/2 MB/);
 assert.throws(()=>imageData({type:'image/svg+xml',base64:Buffer.from('<svg/>').toString('base64')}),/válida/);
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6FoAAAAASUVORK5CYII=';
 assert.equal(imageData({type:'image/png',base64:png}).extension,'png');
});
test('prazo exige fuso explícito e converte horário da Bahia para UTC',() => {
 const data=settingsData({couple_names:'Rafael & Maria',rsvp_deadline_at:'2027-03-20T20:00:00-03:00'});
 assert.equal(data.rsvp_deadline_at,'2027-03-20T23:00:00.000Z');
 assert.throws(()=>settingsData({couple_names:'Casal',rsvp_deadline_at:'2027-03-20T20:00'}),/fuso/);
});
