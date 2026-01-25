package org.bigbluebutton.core.apps.users

import org.bigbluebutton.common2.msgs._
import org.bigbluebutton.core.models.{ UserState, Users2x }
import org.bigbluebutton.core.running.{ LiveMeeting, OutMsgRouter }
import org.bigbluebutton.core.apps.{ RightsManagementTrait }

trait SetUserSpeakingLanguageMsgHdlr extends RightsManagementTrait {
  this: UsersApp =>

  val liveMeeting: LiveMeeting
  val outGW: OutMsgRouter

  def handleSetUserSpeakingLanguageReqMsg(msg: SetUserSpeakingLanguageReqMsg): Unit = {
    log.info("handleSetUserSpeakingLanguageReqMsg: locale={} userId={}", msg.body.locale, msg.header.userId)

    def broadcastUserSpeakingLanguageChanged(user: UserState, locale: String): Unit = {
      val routingChange = Routing.addMsgToClientRouting(
        MessageTypes.BROADCAST_TO_MEETING,
        liveMeeting.props.meetingProp.intId, user.intId
      )
      val envelopeChange = BbbCoreEnvelope(UserSpeakingLanguageChangedEvtMsg.NAME, routingChange)
      val headerChange = BbbClientMsgHeader(UserSpeakingLanguageChangedEvtMsg.NAME, liveMeeting.props.meetingProp.intId, user.intId)

      val bodyChange = UserSpeakingLanguageChangedEvtMsgBody(locale)
      val eventChange = UserSpeakingLanguageChangedEvtMsg(headerChange, bodyChange)
      val msgEventChange = BbbCommonEnvCoreMsg(envelopeChange, eventChange)
      outGW.send(msgEventChange)
    }

    for {
      user <- Users2x.findWithIntId(liveMeeting.users2x, msg.header.userId)
    } yield {
      Users2x.setUserSpeakingLanguage(liveMeeting.users2x, msg.header.userId, msg.body.locale)
      broadcastUserSpeakingLanguageChanged(user, msg.body.locale)
    }
  }
}
