import React from 'react';
import {Radio} from 'lucide-react';
import type {Track} from '../../types/index.js';
import {ProfileStatus,SocialLinks,accentStyle,type Customization} from './ProfileCustomization.js';
import {RoleBadges,topRoleColor,type PublicRole} from './RoleBadge.js';

export function ProfileAvatar({src,name,className='profile-head-avatar'}:{src?:string;name:string;className?:string}){
  return src?<img className={className} src={src} alt=""/>:<span className={className} aria-hidden="true">{name.slice(0,1).toUpperCase()||'?'}</span>;
}

/** One header for every profile — your own and other people's, on desktop and phones. */
export function ProfileHero({displayName,avatarUrl,bannerUrl,username,bio,customization,roles,nowPlaying,eyebrow,meta,actions,children}:{displayName:string;avatarUrl?:string;bannerUrl?:string;username?:string|null;bio?:string;customization?:Customization;roles?:PublicRole[];nowPlaying?:Track|null;eyebrow?:string;meta?:React.ReactNode;actions?:React.ReactNode;children?:React.ReactNode}){
  return <header className={`profile-head crystal-slab profile-theme--${customization?.theme||'default'}`} style={accentStyle(customization)}>
    <div className="profile-head-banner">{bannerUrl?<img src={bannerUrl} alt="" aria-hidden="true"/>:<i className="profile-head-banner-art" aria-hidden="true"/>}</div>
    <div className="profile-head-body">
      <ProfileAvatar src={avatarUrl} name={displayName}/>
      <div className="profile-head-id">
        {eyebrow&&<span className="eyebrow">{eyebrow}</span>}
        <h1 style={{color:topRoleColor(roles)}}>{displayName} <RoleBadges roles={roles}/></h1>
        <ProfileStatus c={customization}/>
        <p>{username?`@${username}`:null}{meta}{nowPlaying&&<span className="profile-head-listening"><Radio size={12}/><span>{nowPlaying.artist.name} — {nowPlaying.title}</span></span>}</p>
        {bio&&<p className="profile-head-bio">{bio}</p>}
        <SocialLinks links={customization?.socialLinks}/>
      </div>
      {actions&&<div className="profile-head-actions">{actions}</div>}
    </div>
    {children}
  </header>;
}
