import React from 'react';
import {useQuery} from '@tanstack/react-query';
import {apiClient} from '../../api/apiClient.js';
import {useTranslation,useLanguageStore} from '../../stores/useLanguageStore.js';
import {useTelegramStore} from '../../telegram/runtime.js';
export function MyReports(){
 const t=useTranslation(),language=useLanguageStore(s=>s.language),user=useTelegramStore(s=>s.user);
 const query=useQuery({queryKey:['my-reports',user?.id],queryFn:()=>apiClient.request<Array<{id:string;reason:string;status:string;reviewNote:string;createdAt?:string}>>('/content/reports'),enabled:!!user});
 const statuses:Record<string,string>={pending:t('На рассмотрении','Pending review'),open:t('Принято','Received'),approved:t('Одобрено','Approved'),rejected:t('Отклонено','Rejected'),resolved:t('Решено','Resolved'),in_progress:t('В работе','In progress'),closed:t('Закрыто','Closed')};
 const reasons:Record<string,string>={bug:t('Ошибка приложения','Application error'),playback:t('Воспроизведение','Playback'),source:t('Источник','Source'),lyrics:t('Текст','Lyrics'),timing:t('Тайминг','Timing')};
 return <section className="frost-panel profile-form"><div className="section-heading"><h2>{t('Мои обращения','My reports')}</h2><button type="button" className="text-button" disabled={query.isFetching} onClick={()=>void query.refetch()}>{query.isFetching?t('Обновляем…','Refreshing…'):t('Обновить','Refresh')}</button></div>{query.isError?<p role="alert">{query.error.message}</p>:query.isPending?<p>{t('Загружаем…','Loading…')}</p>:query.data.length?<ul className="my-reports-list">{query.data.map(report=><li key={report.id}><strong>{reasons[report.reason]||report.reason}</strong><small className="report-id">№ {report.id}</small><p>{statuses[report.status]||report.status}</p>{report.createdAt&&<time dateTime={report.createdAt}>{new Date(report.createdAt).toLocaleDateString(language)}</time>}{report.reviewNote&&<p className="report-review">{t('Ответ администратора','Administrator response')}: {report.reviewNote}</p>}</li>)}</ul>:<p>{t('Вы ещё не отправляли обращения','No reports yet')}</p>}</section>;
}
